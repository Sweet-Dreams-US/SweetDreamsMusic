// app/api/media/bookings/[id]/pay/route.ts
//
// Media Projects — SELF-SERVE installment payment.
//
// The artist pays ANY amount toward the project balance themselves, without
// the manager pre-sending a per-installment link. Default (chosen in the UI)
// is the next unpaid installment, but the artist may pay any amount from $1 up
// to the remaining balance — including paying AHEAD of the schedule.
//
// We mint a one-off Stripe Checkout Session sized to the chosen amount (mirrors
// app/api/booking/create's stripe.checkout.sessions.create style and returns
// session.url for the client to redirect to). The completion webhook
// (meta.type = 'media_project_payment') GREEDILY applies the single payment
// across the pending installments in sort order, splitting the boundary stint
// if the amount lands mid-installment so the schedule total is preserved.
//
// GATING: a plan project cannot start a payment until BOTH parties have agreed
// to the contract (manager_agreed_at AND contract_agreed_at). This mirrors the
// manager-facing send-link route's contract gate — payment is gated where it is
// INITIATED, not at money-arrival.
//
// Ownership: the booking owner, or — for a band-attached booking — any band
// member. Anything else 404s (don't reveal the existence of others' projects).

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getUserBands } from '@/lib/bands-server';
import { SITE_URL } from '@/lib/constants';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  // ── Parse body ─────────────────────────────────────────────────────
  let body: { amount_cents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // ── Load booking ───────────────────────────────────────────────────
  const { data: bookingRow, error: bErr } = await service
    .from('media_bookings')
    .select('id, user_id, band_id, is_test, contract_agreed_at, manager_agreed_at, final_price_cents, offering_id')
    .eq('id', id)
    .maybeSingle();
  if (bErr || !bookingRow) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const booking = bookingRow as {
    id: string;
    user_id: string;
    band_id: string | null;
    is_test: boolean | null;
    contract_agreed_at: string | null;
    manager_agreed_at: string | null;
    final_price_cents: number;
    offering_id: string;
  };

  // ── Ownership — owner OR band member; else 404 (don't reveal existence) ──
  let owns = booking.user_id === user.id;
  if (!owns && booking.band_id) {
    const memberships = await getUserBands(user.id);
    owns = memberships.some((m) => m.band_id === booking.band_id);
  }
  if (!owns) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // ── Guards ─────────────────────────────────────────────────────────
  if (booking.is_test) {
    return NextResponse.json(
      { error: 'Test project — no real payments' },
      { status: 400 },
    );
  }

  // Contract gate — BOTH signatures required before any payment can start.
  if (!booking.manager_agreed_at || !booking.contract_agreed_at) {
    return NextResponse.json(
      {
        error:
          'The contract must be fully agreed (studio + you) before you can make a payment.',
        code: 'contract_not_agreed',
      },
      { status: 409 },
    );
  }

  // ── Load installments → compute remaining balance ──────────────────
  const { data: instRows, error: iErr } = await service
    .from('media_payment_installments')
    .select('id, amount_cents, status')
    .eq('booking_id', id);
  if (iErr) {
    return NextResponse.json({ error: 'Could not load payment plan' }, { status: 500 });
  }
  const installments = (instRows ?? []) as Array<{
    id: string;
    amount_cents: number;
    status: string;
  }>;
  if (installments.length === 0) {
    return NextResponse.json(
      { error: 'No payment plan on this project' },
      { status: 400 },
    );
  }

  const paidCents = installments
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount_cents, 0);
  const remaining = booking.final_price_cents - paidCents;
  if (remaining <= 0) {
    return NextResponse.json(
      { error: 'This project is already paid in full' },
      { status: 400 },
    );
  }

  // ── Validate the requested amount ──────────────────────────────────
  // Integer cents, at least $1, no more than the remaining balance.
  const amountCents = body.amount_cents;
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents)) {
    return NextResponse.json(
      { error: 'Enter a valid payment amount.' },
      { status: 400 },
    );
  }
  if (amountCents < 100) {
    return NextResponse.json(
      { error: 'Minimum payment is $1.00.' },
      { status: 400 },
    );
  }
  if (amountCents > remaining) {
    return NextResponse.json(
      {
        error: `That's more than your remaining balance. The most you can pay is ${(remaining / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`,
      },
      { status: 400 },
    );
  }

  // ── Resolve a friendly line-item name from the offering title ──────
  let offeringTitle = 'Media project';
  const { data: offeringRow } = await service
    .from('media_offerings')
    .select('title')
    .eq('id', booking.offering_id)
    .maybeSingle();
  if (offeringRow && (offeringRow as { title?: string | null }).title) {
    offeringTitle = (offeringRow as { title: string }).title;
  }

  // ── Mint the Checkout Session ──────────────────────────────────────
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: { name: `Project payment — ${offeringTitle}` },
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: id,
        type: 'media_project_payment',
        amount_cents: String(amountCents),
        paid_by: user.id,
      },
      success_url: `${SITE_URL}/dashboard/media/orders/${id}?status=paid`,
      cancel_url: `${SITE_URL}/dashboard/media/orders/${id}`,
    });

    return NextResponse.json({ checkout_url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    console.error('[media/pay] stripe error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
