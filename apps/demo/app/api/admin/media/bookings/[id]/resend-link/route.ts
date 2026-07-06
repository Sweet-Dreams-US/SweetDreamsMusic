// app/api/admin/media/bookings/[id]/resend-link/route.ts
//
// Admin-driven resend of the payment link for a media booking. Common
// case: buyer lost the original email, opened the link on a phone
// where their saved card session expired, or their Klarna/Affirm
// alternative-pay flow timed out.
//
// Why a dedicated endpoint vs. re-using charge-remainder:
//   • The audit row is stamped 'remainder_link_resent' so the history
//     panel distinguishes a resend from the original send.
//   • The endpoint is a no-op safe — it doesn't try to charge anything,
//     just regenerates a Stripe Payment Link and emails it.
//   • Easier to permission/log/throttle separately later if needed.
//
// Body: { amount?: number_in_cents }
//   • Defaults to the row's current outstanding remainder.
//   • Admin can override to send a partial-amount link.
//
// Returns: { success, paymentUrl, amountCharged: 0 } — money hasn't
// moved yet; the buyer still has to click + pay.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSessionUser } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { sendMediaPaymentLink } from '@/lib/email';
import { SITE_URL } from '@/lib/constants';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — defaults to outstanding remainder.
  }

  const requestedAmount =
    typeof body.amount === 'number' && Number.isInteger(body.amount) && body.amount > 0
      ? body.amount
      : null;

  // ── Load the row + buyer ───────────────────────────────────────────
  const service = createServiceClient();
  const { data: bookingRow, error: readErr } = await service
    .from('media_bookings')
    .select(`
      id, user_id, final_price_cents, deposit_cents, actual_deposit_paid,
      final_paid_at, is_test, status
    `)
    .eq('id', id)
    .maybeSingle();

  if (readErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  type Row = {
    id: string;
    user_id: string;
    final_price_cents: number;
    deposit_cents: number | null;
    actual_deposit_paid: number | null;
    final_paid_at: string | null;
    is_test: boolean | null;
    status: string;
  };
  const booking = bookingRow as Row;

  if (booking.is_test) {
    return NextResponse.json(
      { error: 'Test bookings cannot send real payment links.' },
      { status: 400 },
    );
  }
  if (booking.final_paid_at) {
    return NextResponse.json(
      { error: 'This booking is already fully paid.' },
      { status: 400 },
    );
  }

  const paid = booking.actual_deposit_paid ?? booking.deposit_cents ?? 0;
  const remainder = Math.max(0, booking.final_price_cents - paid);
  if (remainder <= 0) {
    return NextResponse.json(
      { error: 'No remainder owed.' },
      { status: 400 },
    );
  }

  const amount =
    requestedAmount && requestedAmount <= remainder ? requestedAmount : remainder;

  // ── Resolve buyer email ───────────────────────────────────────────
  const { data: buyerProfile } = await service
    .from('profiles')
    .select('email, display_name')
    .eq('user_id', booking.user_id)
    .maybeSingle();
  const buyer = buyerProfile as
    | { email: string | null; display_name: string | null }
    | null;
  if (!buyer?.email) {
    return NextResponse.json(
      { error: 'Buyer has no email — admin must collect manually.' },
      { status: 400 },
    );
  }

  // ── New Stripe Payment Link ───────────────────────────────────────
  // We mint a fresh product + price + link rather than reusing prior
  // Stripe objects. Each link lives in Stripe with its own metadata
  // so the webhook can match it back, and admin gets a clean audit
  // entry per resend.
  try {
    const product = await stripe.products.create({
      name: `Media remainder (RESEND) — Booking ${booking.id.slice(0, 8)}`,
      metadata: { booking_id: booking.id, type: 'media_remainder', resend: 'true' },
    });
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: 'usd',
      product: product.id,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: booking.id, type: 'media_remainder', resend: 'true' },
      after_completion: {
        type: 'redirect',
        redirect: { url: `${SITE_URL}/dashboard/media/orders/${booking.id}?status=paid` },
      },
    });

    // Email the buyer
    try {
      await sendMediaPaymentLink(buyer.email, {
        buyerName: buyer.display_name || 'there',
        amount,
        paymentUrl: link.url,
        bookingId: booking.id,
      });
    } catch (e) {
      console.error('[resend-link] email error:', e);
    }

    // Audit
    await service.from('media_booking_audit_log').insert({
      booking_id: booking.id,
      action: 'remainder_link_resent',
      performed_by: user.email,
      details: {
        amount_cents: amount,
        link_url: link.url,
        stripe_price_id: price.id,
        stripe_product_id: product.id,
      },
    });

    return NextResponse.json({
      success: true,
      paymentUrl: link.url,
      amountCharged: 0,
      note: 'New payment link emailed to the buyer.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    console.error('[resend-link] stripe error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
