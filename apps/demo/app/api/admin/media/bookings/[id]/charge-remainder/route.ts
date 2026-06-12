// app/api/admin/media/bookings/[id]/charge-remainder/route.ts
//
// Admin charges the outstanding balance on a media booking. Mirrors the
// existing /api/booking/charge-remainder flow for studio sessions, but
// scoped to media_bookings + with the audit trail going to
// media_booking_audit_log.
//
// Body: { amount?: number_in_cents, method?: 'card' | 'link', changeTotalTo?: number_in_cents }
//
//   • amount     — defaults to the row's remainder (final_price_cents
//                  - actual_deposit_paid). Can be specified to charge
//                  a partial amount.
//   • method     — 'card' attempts an off-session charge against the
//                  saved Stripe payment method. 'link' creates a
//                  Stripe payment link and emails the buyer. Defaults
//                  to 'card' if a saved card exists, else 'link'.
//   • changeTotalTo — admin override of final_price_cents. Used when
//                  scope changed mid-project. The new remainder is
//                  re-derived as (changeTotalTo - actual_deposit_paid).
//
// Returns: success + amountCharged + new remainder. On `link` method,
// also returns the link URL (also emailed to the buyer).

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendMediaPaymentLink } from '@/lib/email';
import { SITE_URL } from '@/lib/constants';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Admin gate ─────────────────────────────────────────────────────
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const requestedAmount = typeof body.amount === 'number' ? body.amount : null;
  const requestedMethod = typeof body.method === 'string' ? body.method : null;
  const changeTotalTo =
    typeof body.changeTotalTo === 'number' && Number.isInteger(body.changeTotalTo) && body.changeTotalTo >= 0
      ? body.changeTotalTo
      : null;

  if (requestedAmount != null && (requestedAmount <= 0 || !Number.isInteger(requestedAmount))) {
    return NextResponse.json(
      { error: 'amount must be a positive integer (cents)' },
      { status: 400 },
    );
  }
  if (requestedMethod && requestedMethod !== 'card' && requestedMethod !== 'link') {
    return NextResponse.json(
      { error: "method must be 'card' or 'link'" },
      { status: 400 },
    );
  }

  // ── Load row ───────────────────────────────────────────────────────
  const service = createServiceClient();
  const { data: bookingRow, error: readErr } = await service
    .from('media_bookings')
    .select(`
      id, offering_id, user_id, band_id,
      final_price_cents, deposit_cents, actual_deposit_paid, final_paid_at,
      stripe_payment_intent_id, stripe_session_id,
      customer_phone, is_test, status
    `)
    .eq('id', id)
    .maybeSingle();

  if (readErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  type Row = {
    id: string;
    offering_id: string;
    user_id: string;
    band_id: string | null;
    final_price_cents: number;
    deposit_cents: number | null;
    actual_deposit_paid: number | null;
    final_paid_at: string | null;
    stripe_payment_intent_id: string | null;
    stripe_session_id: string | null;
    customer_phone: string | null;
    is_test: boolean | null;
    status: string;
  };
  const booking = bookingRow as Row;

  if (booking.is_test) {
    return NextResponse.json(
      { error: 'Test bookings cannot have remainders charged. Use the real flow.' },
      { status: 400 },
    );
  }
  if (booking.final_paid_at) {
    return NextResponse.json(
      { error: 'This booking is already fully paid.' },
      { status: 400 },
    );
  }

  // ── Apply optional total adjustment first ──────────────────────────
  // If admin is upping/lowering the price, write that and recompute the
  // remainder so the charge math uses the new total. Audit captures the
  // delta.
  let workingTotal = booking.final_price_cents;
  if (changeTotalTo != null && changeTotalTo !== booking.final_price_cents) {
    const depositPaid = booking.actual_deposit_paid ?? booking.deposit_cents ?? 0;
    if (changeTotalTo < depositPaid) {
      return NextResponse.json(
        { error: `New total cannot be less than already-paid deposit (${depositPaid} cents).` },
        { status: 400 },
      );
    }
    const { error: updErr } = await service
      .from('media_bookings')
      .update({ final_price_cents: changeTotalTo })
      .eq('id', id);
    if (updErr) {
      return NextResponse.json(
        { error: `Could not adjust total: ${updErr.message}` },
        { status: 500 },
      );
    }
    workingTotal = changeTotalTo;

    await service.from('media_booking_audit_log').insert({
      booking_id: id,
      action: 'total_adjusted',
      performed_by: user.email,
      details: {
        previous_total: booking.final_price_cents,
        new_total: changeTotalTo,
        delta: changeTotalTo - booking.final_price_cents,
      },
    });
  }

  const depositPaid = booking.actual_deposit_paid ?? booking.deposit_cents ?? 0;
  const remainder = Math.max(0, workingTotal - depositPaid);

  if (remainder <= 0) {
    // Either the adjustment dropped the total to match deposit, or the
    // row was somehow zeroed out. Mark as fully paid + done.
    await service
      .from('media_bookings')
      .update({ final_paid_at: new Date().toISOString() })
      .eq('id', id);
    return NextResponse.json({
      success: true,
      amountCharged: 0,
      newRemainder: 0,
      note: 'No remainder to charge after adjustment.',
    });
  }

  const chargeAmount = requestedAmount && requestedAmount <= remainder ? requestedAmount : remainder;

  // ── Resolve buyer email + Stripe customer ──────────────────────────
  const { data: buyerProfile } = await service
    .from('profiles')
    .select('email, display_name')
    .eq('user_id', booking.user_id)
    .maybeSingle();
  const buyer = buyerProfile as { email: string | null; display_name: string } | null;
  const buyerEmail = buyer?.email;
  if (!buyerEmail) {
    return NextResponse.json(
      { error: 'Buyer email not on file — admin must collect remainder manually.' },
      { status: 400 },
    );
  }

  // Look up the Stripe customer the original deposit landed against. We
  // do this via paymentIntents.retrieve since media_bookings stores the
  // PI but not the customer ID directly.
  let stripeCustomerId: string | null = null;
  if (booking.stripe_payment_intent_id) {
    try {
      const pi = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
      stripeCustomerId = (pi.customer as string) || null;
    } catch (e) {
      console.warn('[charge-remainder] PI lookup failed:', e);
    }
  }

  // ── Decide method: card if available + admin didn't force link ─────
  let useCard = requestedMethod === 'card';
  if (!requestedMethod && stripeCustomerId) {
    // Auto-pick: try card if a payment method is saved, else fall back
    // to link.
    try {
      const methods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card',
      });
      useCard = methods.data.length > 0;
    } catch {
      useCard = false;
    }
  }

  if (useCard && stripeCustomerId) {
    // ── CARD: off-session charge ─────────────────────────────────────
    try {
      const methods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card',
      });
      if (methods.data.length === 0) {
        // Saved card disappeared between auto-detect and now — fall through to link.
        return await sendLink(service, booking, buyerEmail, buyer?.display_name ?? 'Buyer', chargeAmount, user.email);
      }
      const paymentIntent = await stripe.paymentIntents.create({
        amount: chargeAmount,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: methods.data[0].id,
        off_session: true,
        confirm: true,
        description: `Media remainder — Booking ${booking.id.slice(0, 8)}`,
        metadata: {
          type: 'media_remainder',
          booking_id: booking.id,
        },
      });

      const newDepositPaid = depositPaid + chargeAmount;
      const newRemainder = Math.max(0, workingTotal - newDepositPaid);
      const updates: Record<string, unknown> = {
        actual_deposit_paid: newDepositPaid,
      };
      if (newRemainder === 0) {
        updates.final_paid_at = new Date().toISOString();
      }
      await service.from('media_bookings').update(updates).eq('id', id);

      await service.from('media_booking_audit_log').insert({
        booking_id: id,
        action: 'remainder_charged_card',
        performed_by: user.email,
        details: {
          amount_cents: chargeAmount,
          payment_intent_id: paymentIntent.id,
          previous_paid: depositPaid,
          new_paid: newDepositPaid,
          new_remainder: newRemainder,
        },
      });

      return NextResponse.json({
        success: true,
        method: 'card',
        amountCharged: chargeAmount,
        paymentIntentId: paymentIntent.id,
        newRemainder,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Card charge failed';
      console.error('[charge-remainder] card error:', err);
      // Fall back to link on card failure so admin can still complete
      // the action without a second click.
      try {
        return await sendLink(service, booking, buyerEmail, buyer?.display_name ?? 'Buyer', chargeAmount, user.email);
      } catch {
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }
  }

  // ── LINK: create Stripe payment link + email it ────────────────────
  return await sendLink(service, booking, buyerEmail, buyer?.display_name ?? 'Buyer', chargeAmount, user.email);
}

// Helper: create a Stripe payment link for the remainder + email it to
// the buyer. The link's metadata carries the booking_id so the webhook
// can match the eventual completion back to the row.
async function sendLink(
  service: ReturnType<typeof createServiceClient>,
  booking: { id: string; final_price_cents: number },
  buyerEmail: string,
  buyerName: string,
  amount: number,
  performedBy: string,
) {
  const product = await stripe.products.create({
    name: `Media remainder — Booking ${booking.id.slice(0, 8)}`,
    metadata: { booking_id: booking.id, type: 'media_remainder' },
  });
  const price = await stripe.prices.create({
    unit_amount: amount,
    currency: 'usd',
    product: product.id,
  });
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { booking_id: booking.id, type: 'media_remainder' },
    after_completion: {
      type: 'redirect',
      redirect: { url: `${SITE_URL}/dashboard/media/orders/${booking.id}?status=paid` },
    },
  });

  // Send to buyer
  try {
    await sendMediaPaymentLink(buyerEmail, {
      buyerName,
      amount,
      paymentUrl: link.url,
      bookingId: booking.id,
    });
  } catch (e) {
    console.error('[charge-remainder] payment link email error:', e);
  }

  await service.from('media_booking_audit_log').insert({
    booking_id: booking.id,
    action: 'remainder_link_sent',
    performed_by: performedBy,
    details: {
      amount_cents: amount,
      link_url: link.url,
      stripe_price_id: price.id,
      stripe_product_id: product.id,
    },
  });

  return NextResponse.json({
    success: true,
    method: 'link',
    amountCharged: 0, // money hasn't moved yet
    paymentUrl: link.url,
    note: 'Payment link emailed to the buyer.',
  });
}
