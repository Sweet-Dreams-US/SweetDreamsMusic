// app/api/packages/entitlements/[id]/redeem-beat/route.ts
//
// POST — redeem a beat_credit balance to claim a free beat license.
// The customer gets the lease (full file delivery, normal license terms).
// The producer gets paid 60% of full retail (Cole's rule: workers get
// full rate regardless of discount). The studio absorbs the
// difference between what the customer paid for the credit (some
// fraction of $74.99 inside their package) and the producer's cut.
//
// Body:
//   {
//     beat_id: string,
//     license_type: 'mp3_lease' | 'trackout_lease' | 'exclusive'
//   }
//
// Constraints:
//   • Beat must be active in the catalog
//   • Customer must have a beat_credit balance with remaining > 0
//   • For exclusive licenses: beat must not be sold exclusive yet,
//     and we mark has_exclusive=false on success
//
// On success: creates a beat_purchases row with payment_method='package_credit'
// and package_entitlement_id set, ticks balance, returns the purchase id
// so client can navigate to the download page.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { BEAT_LICENSES, type BeatLicenseType, LEASE_DURATION_DAYS } from '@/lib/constants';

interface RedeemBeatBody {
  beat_id?: string;
  license_type?: BeatLicenseType;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: entitlementId } = await params;
  if (!entitlementId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: RedeemBeatBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.beat_id) return NextResponse.json({ error: 'beat_id required' }, { status: 400 });
  if (!body.license_type || !(body.license_type in BEAT_LICENSES)) {
    return NextResponse.json({ error: 'Invalid license_type' }, { status: 400 });
  }

  const service = createServiceClient();

  // ── Pull entitlement + verify ownership ──────────────────────────
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

  // ── Verify balance ───────────────────────────────────────────────
  const { data: balRow } = await service
    .from('package_entitlement_balances')
    .select('id, quantity_granted, quantity_redeemed, redemptions')
    .eq('entitlement_id', entitlementId)
    .eq('kind', 'beat_credit')
    .maybeSingle();
  if (!balRow) return NextResponse.json({ error: 'No beat credits in this package.' }, { status: 400 });
  type Bal = { id: string; quantity_granted: number; quantity_redeemed: number; redemptions: Array<Record<string, unknown>> };
  const bal = balRow as Bal;
  const remaining = bal.quantity_granted - bal.quantity_redeemed;
  if (remaining < 1) {
    return NextResponse.json({ error: 'No beat credits remaining.' }, { status: 400 });
  }

  // ── Verify beat is purchasable ───────────────────────────────────
  const { data: beatRow } = await service
    .from('beats')
    .select('id, title, has_exclusive, mp3_file_path, trackout_file_path')
    .eq('id', body.beat_id)
    .maybeSingle();
  if (!beatRow) return NextResponse.json({ error: 'Beat not found.' }, { status: 404 });
  type Beat = { id: string; title: string; has_exclusive: boolean | null; mp3_file_path: string | null; trackout_file_path: string | null };
  const beat = beatRow as Beat;

  if (body.license_type === 'exclusive' && beat.has_exclusive === false) {
    return NextResponse.json({ error: 'This beat has already been purchased exclusively.' }, { status: 400 });
  }
  if (body.license_type === 'trackout_lease' && !beat.trackout_file_path) {
    return NextResponse.json({ error: 'Trackout files not available for this beat.' }, { status: 400 });
  }

  // ── Compute pricing ──────────────────────────────────────────────
  const fullPriceCents = BEAT_LICENSES[body.license_type].defaultPrice;
  const leaseDays = LEASE_DURATION_DAYS[body.license_type];
  const leaseExpiresAt = leaseDays ? new Date(Date.now() + leaseDays * 86400 * 1000).toISOString() : null;

  // ── Customer profile for buyer fields ────────────────────────────
  const { data: profile } = await service
    .from('profiles')
    .select('display_name, email')
    .eq('user_id', user.id)
    .maybeSingle();
  const buyerName = (profile as { display_name: string | null } | null)?.display_name ?? user.email.split('@')[0];

  // ── Insert beat purchase ─────────────────────────────────────────
  // amount_paid = full retail so producer's 60% comes out correctly in
  // the existing accounting calc. payment_method='package_credit' flags
  // it as entitlement-funded — accounting endpoint can subtract these
  // to compute actual cash collected vs. producer payout owed.
  const { data: purchaseInsert, error: purchaseErr } = await service
    .from('beat_purchases')
    .insert({
      beat_id: body.beat_id,
      buyer_id: user.id,
      buyer_email: user.email,
      buyer_name: buyerName,
      license_type: body.license_type,
      amount_paid: fullPriceCents,
      payment_method: 'package_credit',
      package_entitlement_id: entitlementId,
      lease_expires_at: leaseExpiresAt,
      sales_tax_cents: 0,
    })
    .select('id')
    .single();
  if (purchaseErr || !purchaseInsert) {
    console.error('[redeem-beat] purchase insert:', purchaseErr);
    return NextResponse.json({ error: purchaseErr?.message ?? 'Purchase failed' }, { status: 500 });
  }
  const purchaseId = (purchaseInsert as { id: string }).id;

  // If exclusive, flip the beat's has_exclusive flag (it's no longer
  // purchasable exclusively).
  if (body.license_type === 'exclusive') {
    await service.from('beats').update({ has_exclusive: false }).eq('id', body.beat_id);
  }

  // ── Tick balance ─────────────────────────────────────────────────
  const newRedemptions = [
    ...(bal.redemptions ?? []),
    {
      purchase_id: purchaseId,
      beat_id: body.beat_id,
      license_type: body.license_type,
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
    console.error('[redeem-beat] balance update; rolling back purchase:', balErr);
    await service.from('beat_purchases').delete().eq('id', purchaseId);
    return NextResponse.json({ error: balErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    purchase_id: purchaseId,
    beat_title: beat.title,
    credits_remaining: remaining - 1,
  });
}
