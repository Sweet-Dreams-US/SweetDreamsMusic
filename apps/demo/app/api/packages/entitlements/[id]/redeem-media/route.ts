// app/api/packages/entitlements/[id]/redeem-media/route.ts
//
// POST — redeem a media_offering balance to start a media production
// order. Creates a media_bookings row in 'deposited' status (acts like
// a paid order — admin works through the normal production flow).
// total_paid=0 since the package covered it; final_price_cents = the
// offering's full retail so workers get correctly paid the standard
// commissions.
//
// Body:
//   {
//     balance_id: string,           // which beat_credit balance to consume
//                                   // (in case multiple media lines exist)
//     project_details?: object,     // free-form: title, references, etc.
//     notes?: string,
//   }
//
// The balance must reference a media_offering_id (otherwise we don't
// know which offering to book). Customer doesn't pick the offering —
// it was set when the package was minted.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

interface RedeemMediaBody {
  balance_id?: string;
  project_details?: Record<string, unknown> | null;
  notes?: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: entitlementId } = await params;
  if (!entitlementId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: RedeemMediaBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.balance_id) return NextResponse.json({ error: 'balance_id required' }, { status: 400 });

  const service = createServiceClient();

  // ── Pull entitlement + verify ──
  const { data: entRow } = await service
    .from('package_entitlements')
    .select('id, user_id, band_id, status, payment_status, ends_at')
    .eq('id', entitlementId)
    .maybeSingle();
  if (!entRow) return NextResponse.json({ error: 'Entitlement not found' }, { status: 404 });
  type Ent = { id: string; user_id: string | null; band_id: string | null; status: string; payment_status: string; ends_at: string };
  const ent = entRow as Ent;

  if (ent.status !== 'active') {
    return NextResponse.json({ error: `Cannot redeem from a ${ent.status} entitlement.` }, { status: 400 });
  }
  if (new Date(ent.ends_at) < new Date()) {
    return NextResponse.json({ error: 'This entitlement has expired.' }, { status: 400 });
  }
  if (ent.payment_status === 'collections' || ent.payment_status === 'written_off') {
    return NextResponse.json({ error: 'Entitlement is on hold pending payment.' }, { status: 400 });
  }

  // Authorize.
  let authorized = false;
  if (ent.user_id && ent.user_id === user.id) authorized = true;
  else if (ent.band_id) {
    const { data: m } = await service.from('band_members').select('role').eq('band_id', ent.band_id).eq('user_id', user.id).maybeSingle();
    if (m) authorized = true;
  }
  if (!authorized) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });

  // ── Pull the specific balance ──
  const { data: balRow } = await service
    .from('package_entitlement_balances')
    .select('id, kind, media_offering_id, full_price_cents, quantity_granted, quantity_redeemed, redemptions')
    .eq('id', body.balance_id)
    .eq('entitlement_id', entitlementId)
    .maybeSingle();
  if (!balRow) {
    return NextResponse.json({ error: 'Balance not found in this entitlement.' }, { status: 404 });
  }
  type Bal = {
    id: string; kind: string; media_offering_id: string | null; full_price_cents: number;
    quantity_granted: number; quantity_redeemed: number;
    redemptions: Array<Record<string, unknown>>;
  };
  const bal = balRow as Bal;

  if (bal.kind !== 'media_offering') {
    return NextResponse.json({ error: 'This balance is not a media offering.' }, { status: 400 });
  }
  if (!bal.media_offering_id) {
    return NextResponse.json({ error: 'No media offering attached to this balance.' }, { status: 400 });
  }
  const remaining = bal.quantity_granted - bal.quantity_redeemed;
  if (remaining < 1) {
    return NextResponse.json({ error: 'No redemptions left on this balance.' }, { status: 400 });
  }

  // ── Insert media_booking ──
  // status='deposited' so admin sees it in the normal media orders queue.
  // final_price_cents = offering's full retail (used by accounting/payouts).
  // actual_deposit_paid = 0 (no Stripe).
  const { data: mediaInsert, error: mediaErr } = await service
    .from('media_bookings')
    .insert({
      offering_id: bal.media_offering_id,
      user_id: user.id,
      band_id: ent.band_id,
      status: 'deposited',
      final_price_cents: bal.full_price_cents,
      deposit_cents: 0,
      actual_deposit_paid: 0,
      deposit_paid_at: new Date().toISOString(),
      package_entitlement_id: entitlementId,
      notes_to_us: body.notes ?? null,
      project_details: body.project_details ?? null,
      created_by: user.email,
    })
    .select('id')
    .single();
  if (mediaErr || !mediaInsert) {
    console.error('[redeem-media] media booking insert:', mediaErr);
    return NextResponse.json({ error: mediaErr?.message ?? 'Booking insert failed' }, { status: 500 });
  }
  const mediaBookingId = (mediaInsert as { id: string }).id;

  // ── Tick balance ──
  const newRedemptions = [
    ...(bal.redemptions ?? []),
    {
      media_booking_id: mediaBookingId,
      redeemed_at: new Date().toISOString(),
    },
  ];
  const { error: balErr } = await service
    .from('package_entitlement_balances')
    .update({
      quantity_redeemed: bal.quantity_redeemed + 1,
      redemptions: newRedemptions,
    })
    .eq('id', bal.id);
  if (balErr) {
    console.error('[redeem-media] balance update; rolling back booking:', balErr);
    await service.from('media_bookings').delete().eq('id', mediaBookingId);
    return NextResponse.json({ error: balErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    media_booking_id: mediaBookingId,
    remaining: remaining - 1,
  });
}
