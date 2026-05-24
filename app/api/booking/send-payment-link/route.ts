import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { PRICING, SITE_URL } from '@/lib/constants';
import { formatDuration } from '@/lib/utils';
import { sendPaymentLink } from '@/lib/email';

// POST — create a Stripe payment link and email it to the client
// Works for ANY booking, even without a saved Stripe customer
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId, amount } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, stripe_customer_id, remainder_amount, total_amount, status, customer_email, customer_name, duration, room, start_time')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Use provided amount (in cents) or default to the remainder
  const chargeAmount = amount || booking.remainder_amount;
  if (chargeAmount <= 0) {
    return NextResponse.json({ error: 'Nothing to charge' }, { status: 400 });
  }

  if (!booking.customer_email) {
    return NextResponse.json({ error: 'No customer email on this booking' }, { status: 400 });
  }

  try {
    const dateStr = new Date(booking.start_time).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });

    // Build checkout session — attach customer if we have one, otherwise just use email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionParams: any = {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: PRICING.currency,
            product_data: {
              name: 'Recording Session — Balance Due',
              description: `Balance for ${formatDuration(booking.duration)} session on ${dateStr}`,
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
    };

    if (booking.stripe_customer_id) {
      sessionParams.customer = booking.stripe_customer_id;
    } else {
      sessionParams.customer_email = booking.customer_email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Email the payment link to the client
    if (session.url) {
      await sendPaymentLink(booking.customer_email, {
        customerName: booking.customer_name || 'there',
        amount: chargeAmount,
        paymentUrl: session.url,
      });
      console.log(`[PAYMENT LINK] Sent to ${booking.customer_email} for ${chargeAmount} cents`);
    }

    return NextResponse.json({
      success: true,
      paymentUrl: session.url,
      emailSent: true,
      amount: chargeAmount,
    });
  } catch (err) {
    console.error('Failed to create payment link:', err);
    return NextResponse.json({ error: 'Failed to create payment link' }, { status: 500 });
  }
}
