// app/api/media/bookings/[id]/agree/route.ts
//
// Media Projects — artist agrees to the project contract.
//
// POST → stamp contract_agreed_at=now(), contract_agreed_by=user.id on the
//        media_bookings row. Audit: `contract_agreed`.
//
// Auth: the signed-in user must be the booking owner OR a member of the
// attached band (same model as app/api/media/sessions). NOT admin-gated —
// this is the artist-facing action.
//
// Idempotent: if the contract is already agreed, returns success with a
// no-op flag and does not re-stamp or re-audit.
//
// Guard: refuses if there are no contract terms to agree to (nothing to
// consent to yet — the manager hasn't written the contract).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { loadBookingForArtist } from '@/lib/media-installments-server';
import { finalizeIfBothSigned } from '@/lib/media-contract-finalize';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  const { id } = await params;
  const service = createServiceClient();

  // Ownership: owner OR band member.
  const result = await loadBookingForArtist(id, user.id, service);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const booking = result.booking;

  // Nothing to agree to if the manager hasn't authored terms.
  if (!booking.contract_terms || !booking.contract_terms.trim()) {
    return NextResponse.json(
      { error: 'There are no contract terms to agree to yet.' },
      { status: 400 },
    );
  }

  // Idempotent — already agreed. Still attempt finalize: the manager may
  // have signed AFTER the artist, and the finalize is itself idempotent
  // (guarded by project_details.contract_finalized_at).
  if (booking.contract_agreed_at) {
    let finalize;
    try {
      finalize = await finalizeIfBothSigned(service, id);
    } catch (e) {
      console.error('[media/agree] finalize error (already agreed):', e);
    }
    return NextResponse.json({
      success: true,
      alreadyAgreed: true,
      contract_agreed_at: booking.contract_agreed_at,
      contract_agreed_by: booking.contract_agreed_by,
      finalized: finalize?.finalized ?? false,
      sessionsCreated: finalize?.sessionsCreated ?? 0,
      warnings: finalize?.warnings ?? [],
    });
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await service
    .from('media_bookings')
    .update({
      contract_agreed_at: nowIso,
      contract_agreed_by: user.id,
    })
    .eq('id', id)
    // Race guard: only stamp if still unagreed. A concurrent agree won't
    // double-write.
    .is('contract_agreed_at', null);
  if (updErr) {
    console.error('[media/agree] update error:', updErr);
    return NextResponse.json(
      { error: 'Could not record agreement' },
      { status: 500 },
    );
  }

  // Audit (performed_by = the artist's email, not an admin).
  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: 'contract_agreed',
    performed_by: user.email || user.id,
    details: {
      agreed_by_user_id: user.id,
      agreed_at: nowIso,
    },
  });

  // After the artist signs, finalize if the manager has also signed. This is
  // the normal ordering (manager signs on send → artist signs second). Any
  // planned shoots drop onto the calendar and both parties get a confirmation.
  let finalize;
  try {
    finalize = await finalizeIfBothSigned(service, id);
  } catch (e) {
    console.error('[media/agree] finalize error:', e);
  }

  return NextResponse.json({
    success: true,
    alreadyAgreed: false,
    contract_agreed_at: nowIso,
    contract_agreed_by: user.id,
    finalized: finalize?.finalized ?? false,
    sessionsCreated: finalize?.sessionsCreated ?? 0,
    warnings: finalize?.warnings ?? [],
  });
}
