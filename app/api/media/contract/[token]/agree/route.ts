// app/api/media/contract/[token]/agree/route.ts
//
// NO-LOGIN contract SIGN — public, unauthenticated.
//
// POST → the customer signs the contract from the tokenized /contract/[token]
// page WITHOUT logging in. Mirrors the session agree route
// (app/api/media/bookings/[id]/agree) but the credential is the token, not a
// Supabase session.
//
// SECURITY:
//   * The booking is resolved SOLELY by public_token. No booking id is ever
//     read from the client, so a token can only ever sign its own contract and
//     reveal nothing about any other booking.
//   * 404 (not 403) on a missing/invalid token — don't confirm a token's
//     (non-)existence.
//
// Behavior: stamp contract_agreed_at if the manager has signed
// (manager_agreed_at present) and the contract isn't already signed.
// Idempotent (race-guarded on contract_agreed_at IS NULL). Always attempts
// finalizeIfBothSigned (itself idempotent).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { finalizeIfBothSigned } from '@/lib/media-contract-finalize';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Defensive: a too-short / empty token can never be valid. Treat as not found
  // rather than running a query with a trivially-guessable value.
  if (!token || token.length < 32) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  }

  const service = createServiceClient();

  // ── Resolve the booking by TOKEN ONLY ──────────────────────────────
  const { data: bookingRow, error: bErr } = await service
    .from('media_bookings')
    .select('id, contract_terms, contract_agreed_at, manager_agreed_at')
    .eq('public_token', token)
    .maybeSingle();
  if (bErr || !bookingRow) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  }
  const booking = bookingRow as {
    id: string;
    contract_terms: string | null;
    contract_agreed_at: string | null;
    manager_agreed_at: string | null;
  };
  const id = booking.id;

  // Nothing to agree to if the manager hasn't authored / signed the contract.
  if (!booking.contract_terms || !booking.contract_terms.trim()) {
    return NextResponse.json(
      { error: 'There are no contract terms to agree to yet.' },
      { status: 400 },
    );
  }
  if (!booking.manager_agreed_at) {
    return NextResponse.json(
      { error: 'This contract is not ready to sign yet.' },
      { status: 400 },
    );
  }

  // Idempotent — already signed. Still attempt finalize (manager may have
  // signed after the customer; finalize is guarded by contract_finalized_at).
  if (booking.contract_agreed_at) {
    let finalize;
    try {
      finalize = await finalizeIfBothSigned(service, id);
    } catch (e) {
      console.error('[media/contract/agree] finalize error (already agreed):', e);
    }
    return NextResponse.json({
      success: true,
      alreadyAgreed: true,
      contract_agreed_at: booking.contract_agreed_at,
      finalized: finalize?.finalized ?? false,
    });
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await service
    .from('media_bookings')
    .update({ contract_agreed_at: nowIso })
    .eq('id', id)
    // Race guard: only stamp if still unsigned.
    .is('contract_agreed_at', null);
  if (updErr) {
    console.error('[media/contract/agree] update error:', updErr);
    return NextResponse.json(
      { error: 'Could not record agreement' },
      { status: 500 },
    );
  }

  // Audit: performed_by marks this as a public, token-signed agreement (we have
  // no session user here). contract_agreed_by is intentionally NOT set — there
  // is no authenticated user id to attribute it to.
  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: 'contract_agreed',
    performed_by: 'public_token',
    details: {
      agreed_at: nowIso,
      via: 'public_contract_link',
    },
  });

  // After the customer signs, finalize if the manager has too (normal order:
  // manager signs on send → customer signs second). Planned shoots drop onto
  // the calendar and both parties get a confirmation.
  let finalize;
  try {
    finalize = await finalizeIfBothSigned(service, id);
  } catch (e) {
    console.error('[media/contract/agree] finalize error:', e);
  }

  return NextResponse.json({
    success: true,
    alreadyAgreed: false,
    contract_agreed_at: nowIso,
    finalized: finalize?.finalized ?? false,
  });
}
