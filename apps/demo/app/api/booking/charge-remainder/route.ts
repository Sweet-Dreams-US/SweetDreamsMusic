import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { PRICING, SITE_URL } from '@/lib/constants';
import { sendPaymentLink } from '@/lib/email';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId, amount } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  // Get booking details
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, stripe_customer_id, stripe_payment_intent_id, remainder_amount, total_amount, status, customer_email, customer_name')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Use provided amount or default to the remainder
  const chargeAmount = amount || booking.remainder_amount;
  if (chargeAmount <= 0) {
    return NextResponse.json({ error: 'Nothing to charge' }, { status: 400 });
  }

  try {
    // No saved Stripe customer (e.g. a cash session) — no card to charge, so go
    // straight to an emailed payment link. Per the "card fails → link" rule,
    // "no card on file" is just an immediate failure to charge.
    if (!booking.stripe_customer_id) {
      return createPaymentLink(booking, chargeAmount);
    }
    // Get saved payment methods for this customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: booking.stripe_customer_id,
      type: 'card',
    });

    if (paymentMethods.data.length === 0) {
      // No saved card — fall back to payment link
      return createPaymentLink(booking, chargeAmount);
    }

    // Try charging the saved card off-session
    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeAmount,
      currency: 'usd',
      customer: booking.stripe_customer_id,
      payment_method: paymentMethods.data[0].id,
      off_session: true,
      confirm: true,
      description: `Session remainder — Booking ${booking.id.slice(0, 8)}`,
      metadata: {
        type: 'booking_remainder',
        booking_id: booking.id,
      },
    });

    // Update booking
    const updates: Record<string, unknown> = {
      remainder_amount: Math.max(0, booking.remainder_amount - chargeAmount),
    };

    if (amount && amount !== booking.remainder_amount) {
      updates.total_amount = booking.total_amount - booking.remainder_amount + amount;
    }

    await supabase.from('bookings').update(updates).eq('id', bookingId);

    return NextResponse.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      amountCharged: chargeAmount,
    });
  } catch (err: unknown) {
    const stripeError = err as { type?: string; code?: string; message?: string };
    console.error('Off-session charge failed:', stripeError.type, stripeError.code, stripeError.message);

    // If the card was declined for any reason (insufficient funds, SCA required, etc.)
    // fall back to a Stripe Checkout payment link the client can complete themselves
    if (stripeError.type === 'StripeCardError' || stripeError.code === 'authentication_required') {
      return createPaymentLink(booking, chargeAmount);
    }

    return NextResponse.json({ error: `Charge failed: ${stripeError.message || 'Unknown error'}` }, { status: 500 });
  }
}

// Create a Stripe Checkout session the client can pay through
async function createPaymentLink(
  booking: { id: string; stripe_customer_id: string | null; customer_email: string; customer_name: string; remainder_amount: number; total_amount: number },
  chargeAmount: number,
) {
  try {
    const session = await stripe.checkout.sessions.create({
      ...(booking.stripe_customer_id
        ? { customer: booking.stripe_customer_id }
        : { customer_email: booking.customer_email }),
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: PRICING.currency,
            product_data: {
              name: 'Recording Session — Remaining Balance',
              description: `Remaining balance for booking ${booking.id.slice(0, 8)}`,
            },
            unit_amount: chargeAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'booking_remainder',
        booking_id: booking.id,
        charge_amount: String(chargeAmount),
      },
      success_url: `${SITE_URL}/dashboard?paid=1`,
      cancel_url: `${SITE_URL}/dashboard`,
    });

    // Auto-send payment link email to the client
    if (booking.customer_email && session.url) {
      await sendPaymentLink(booking.customer_email, {
        customerName: booking.customer_name || 'there',
        amount: chargeAmount,
        paymentUrl: session.url,
      });
      console.log(`[CHARGE] Payment link emailed to ${booking.customer_email} for ${chargeAmount} cents`);
    }

    return NextResponse.json({
      success: false,
      fallback: true,
      paymentUrl: session.url,
      emailSent: !!booking.customer_email,
      message: 'Could not charge saved card automatically. A payment link has been emailed to the client.',
    });
  } catch (linkErr) {
    console.error('Failed to create payment link fallback:', linkErr);
    return NextResponse.json({ error: 'Card declined and could not create payment link' }, { status: 500 });
  }
}
