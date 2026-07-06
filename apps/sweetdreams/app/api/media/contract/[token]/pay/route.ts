// app/api/media/contract/[token]/pay/route.ts
//
// NO-LOGIN contract PAYMENT — public, unauthenticated.
//
// POST { amount_cents } → the customer pays any amount toward the project
// balance from the tokenized /contract/[token] page WITHOUT logging in. Mirrors
// the self-serve session pay route (app/api/media/bookings/[id]/pay) exactly —
// same amount validation, same Stripe Checkout shape, same
// metadata.type 'media_project_payment' so the existing completion webhook
// applies the payment unchanged. The only difference is the credential: the
// token, not a Supabase session.
//
// SECURITY:
//   * The booking is resolved SOLELY by public_token. No booking id is ever
//     read from the client, so a token can only ever pay its own contract and
//     reveal nothing about any other booking.
//   * 404 (not 403) on a missing/invalid token.
//   * is_test bookings REFUSE payment (400) — mirrors the session pay route's
//     is_test guard. The page may render, but no real money can move.
//   * Both signatures are required before any payment can start (manager +
//     customer), same gate as the session route.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/constants';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Defensive: a too-short / empty token can never be valid.
  if (!token || token.length < 32) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  }

  const service = createServiceClient();

  // ── Parse body ─────────────────────────────────────────────────────
  let body: { amount_cents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // ── Resolve the booking by TOKEN ONLY ──────────────────────────────
  const { data: bookingRow, error: bErr } = await service
    .from('media_bookings')
    .select(
      'id, is_test, contract_agreed_at, manager_agreed_at, final_price_cents, offering_id',
    )
    .eq('public_token', token)
    .maybeSingle();
  if (bErr || !bookingRow) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  }
  const booking = bookingRow as {
    id: string;
    is_test: boolean | null;
    contract_agreed_at: string | null;
    manager_agreed_at: string | null;
    final_price_cents: number;
    offering_id: string;
  };
  const id = booking.id;

  // ── Guards ─────────────────────────────────────────────────────────
  // is_test — REFUSE (mirror the session pay route). The page may render in
  // test mode, but the pay action never moves real money.
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

  // ── Validate the requested amount (integer cents, >= $1, <= remaining) ──
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
  // Same shape + metadata as the session pay route so the existing
  // media_project_payment webhook applies this payment unchanged. The booking
  // id in metadata is the TOKEN-RESOLVED id (never a client-supplied value).
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
        via: 'public_contract_link',
      },
      success_url: `${SITE_URL}/contract/${token}?status=paid`,
      cancel_url: `${SITE_URL}/contract/${token}`,
    });

    return NextResponse.json({ checkout_url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    console.error('[media/contract/pay] stripe error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
