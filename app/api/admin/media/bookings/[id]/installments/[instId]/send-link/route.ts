// app/api/admin/media/bookings/[id]/installments/[instId]/send-link/route.ts
//
// Media Projects — send (or resend) a Stripe Payment Link for ONE
// installment, and email it to the artist.
//
// Adapts the charge-remainder / resend-link "link" path: mint a Stripe
// product → price → payment link sized to the installment's amount, with
// metadata { booking_id, installment_id, type:'media_installment' } so the
// webhook can match the eventual completion back to the exact stint. Store
// the link id/url on the row, flip status to 'link_sent', and email the
// artist via the existing sendMediaPaymentLink template.
//
// Re-calling = resend (a fresh Stripe link). Audit verb:
//   • first send  → 'installment_link_sent'
//   • subsequent  → 'installment_link_resent'
//
// GATING: a plan project cannot start a payment until the artist has agreed
// to the contract. The manager-facing send-link enforces this server-side
// too (defense in depth alongside the artist UI + agree route) — a link
// can't go out before contract_agreed_at is set.
//
// Admin-gated. Cannot send for a `paid` or `void` stint.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendMediaPaymentLink } from '@/lib/email';
import { SITE_URL } from '@/lib/constants';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; instId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id, instId } = await params;
  const service = createServiceClient();

  // ── Load booking (for buyer + contract gate + test guard) ──────────
  const { data: bookingRow, error: bErr } = await service
    .from('media_bookings')
    .select('id, user_id, is_test, contract_agreed_at')
    .eq('id', id)
    .maybeSingle();
  if (bErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  const booking = bookingRow as {
    id: string;
    user_id: string;
    is_test: boolean | null;
    contract_agreed_at: string | null;
  };
  if (booking.is_test) {
    return NextResponse.json(
      { error: 'Test bookings cannot send real payment links.' },
      { status: 400 },
    );
  }

  // ── Contract gate ──────────────────────────────────────────────────
  if (!booking.contract_agreed_at) {
    return NextResponse.json(
      {
        error:
          'The artist must agree to the contract before any payment link can be sent.',
        code: 'contract_not_agreed',
      },
      { status: 409 },
    );
  }

  // ── Load the installment ───────────────────────────────────────────
  const { data: instRow, error: iErr } = await service
    .from('media_payment_installments')
    .select('id, booking_id, label, amount_cents, status')
    .eq('id', instId)
    .eq('booking_id', id)
    .maybeSingle();
  if (iErr || !instRow) {
    return NextResponse.json({ error: 'Installment not found' }, { status: 404 });
  }
  const installment = instRow as {
    id: string;
    booking_id: string;
    label: string;
    amount_cents: number;
    status: string;
  };

  if (installment.status === 'paid') {
    return NextResponse.json(
      { error: 'This installment is already paid.' },
      { status: 400 },
    );
  }
  if (installment.status === 'void') {
    return NextResponse.json(
      { error: 'This installment is void.' },
      { status: 400 },
    );
  }
  if (installment.amount_cents <= 0) {
    return NextResponse.json(
      { error: 'Cannot send a link for a zero-amount installment.' },
      { status: 400 },
    );
  }

  const isResend = installment.status === 'link_sent';

  // ── Resolve buyer email ────────────────────────────────────────────
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
      { error: 'Buyer has no email on file — collect this installment manually.' },
      { status: 400 },
    );
  }

  // ── Mint Stripe product → price → payment link ─────────────────────
  // Metadata carries installment_id so the webhook matches completion to
  // the exact stint. After completion, redirect to the artist order page.
  try {
    const metadata = {
      booking_id: id,
      installment_id: instId,
      type: 'media_installment',
      resend: isResend ? 'true' : 'false',
    };
    const product = await stripe.products.create({
      name: `${installment.label} — Project ${id.slice(0, 8)}`,
      metadata,
    });
    const price = await stripe.prices.create({
      unit_amount: installment.amount_cents,
      currency: 'usd',
      product: product.id,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      after_completion: {
        type: 'redirect',
        redirect: { url: `${SITE_URL}/dashboard/media/orders/${id}?status=paid` },
      },
    });

    // Persist link wiring + flip status to link_sent.
    const { error: updErr } = await service
      .from('media_payment_installments')
      .update({
        status: 'link_sent',
        stripe_payment_link_id: link.id,
        stripe_payment_link_url: link.url,
      })
      .eq('id', instId)
      .eq('booking_id', id);
    if (updErr) {
      console.error('[installments/send-link] status update error:', updErr);
      return NextResponse.json(
        { error: `Link created but could not update installment: ${updErr.message}`, paymentUrl: link.url },
        { status: 500 },
      );
    }

    // Email the artist (reuse the media payment-link template).
    try {
      await sendMediaPaymentLink(buyer.email, {
        buyerName: buyer.display_name || 'there',
        amount: installment.amount_cents,
        paymentUrl: link.url,
        bookingId: id,
      });
    } catch (e) {
      console.error('[installments/send-link] email error:', e);
    }

    // Audit
    await service.from('media_booking_audit_log').insert({
      booking_id: id,
      action: isResend ? 'installment_link_resent' : 'installment_link_sent',
      performed_by: user.email,
      details: {
        installment_id: instId,
        label: installment.label,
        amount_cents: installment.amount_cents,
        link_url: link.url,
        stripe_payment_link_id: link.id,
        stripe_price_id: price.id,
        stripe_product_id: product.id,
      },
    });

    return NextResponse.json({
      success: true,
      resend: isResend,
      paymentUrl: link.url,
      installmentId: instId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    console.error('[installments/send-link] stripe error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
