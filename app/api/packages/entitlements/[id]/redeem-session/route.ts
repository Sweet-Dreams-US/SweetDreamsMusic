// app/api/packages/entitlements/[id]/redeem-session/route.ts
//
// POST — redeem studio_hours from a package entitlement to create a
// session booking. The customer's balance ticks down by the booked
// hours; the booking row gets package_entitlement_id set + total_paid
// = 0 (no Stripe involved).
//
// Round E constraints (per Cole's locked-in design):
//   • Studio B only — customer wanting Studio A pays the surcharge
//     via the regular /book flow at full retail
//   • Not same-day — must be 24+ hours from now
//   • Standard hours only (8am-10pm) — late/deep night use the
//     regular /book flow with surcharge
//   • Booked hours must be ≤ remaining studio_hours balance
//
// Body:
//   {
//     start_time: string,     // ISO datetime
//     end_time: string,       // ISO datetime — duration is computed
//     requested_engineer?: string,
//     notes?: string,
//     // For band entitlements: which band member is booking on the
//     // band's behalf (the customer is always the booker, the band
//     // owns the entitlement).
//   }
//
// Auth: caller must own the entitlement (user_id) or be a member of
// the band that owns it. We don't require admin/manager-only on band
// entitlements — Cole's rule: any band member can redeem the band's
// prepaid balance.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { fmtStampDate } from '@/lib/studio-time';

const STUDIO_B_OPEN_HOUR = 8;   // 8:00 AM (inclusive)
const STUDIO_B_CLOSE_HOUR = 22; // 10:00 PM (sessions must end by this)
const SAME_DAY_BUFFER_HOURS = 24;

interface RedeemBody {
  start_time?: string;
  end_time?: string;
  requested_engineer?: string | null;
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

  let body: RedeemBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.start_time || !body.end_time) {
    return NextResponse.json({ error: 'start_time and end_time required' }, { status: 400 });
  }

  const startDate = new Date(body.start_time);
  const endDate = new Date(body.end_time);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }
  if (endDate <= startDate) {
    return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
  }

  // Compute hours (ceiling — partial hours count as a full hour
  // against the balance, matching how Studio B's hourly rate works).
  const durationMs = endDate.getTime() - startDate.getTime();
  const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));
  if (durationHours < 1) {
    return NextResponse.json({ error: 'Minimum session is 1 hour' }, { status: 400 });
  }

  // Same-day buffer
  const hoursFromNow = (startDate.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursFromNow < SAME_DAY_BUFFER_HOURS) {
    return NextResponse.json(
      {
        error: 'Membership sessions must be booked 24+ hours in advance. For same-day, book through /book and pay the same-day fee.',
      },
      { status: 400 },
    );
  }

  // Hours-of-day check (Fort Wayne local — using the same TIMEZONE as
  // the rest of the app). For simplicity we check on the UTC values
  // since the existing booking system stores wall-clock-as-UTC.
  const startHour = startDate.getUTCHours() + startDate.getUTCMinutes() / 60;
  const endHour = endDate.getUTCHours() + endDate.getUTCMinutes() / 60;
  if (startHour < STUDIO_B_OPEN_HOUR || endHour > STUDIO_B_CLOSE_HOUR) {
    return NextResponse.json(
      {
        error: 'Membership sessions are 8am–10pm. For late-night sessions, book through /book and pay the after-hours surcharge.',
      },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  // ── Pull entitlement + verify ownership ──────────────────────────
  const { data: entRow, error: entErr } = await service
    .from('package_entitlements')
    .select('id, user_id, band_id, status, payment_status, ends_at')
    .eq('id', entitlementId)
    .maybeSingle();
  if (entErr || !entRow) {
    return NextResponse.json({ error: 'Entitlement not found' }, { status: 404 });
  }
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
  if (ent.user_id && ent.user_id === user.id) {
    authorized = true;
  } else if (ent.band_id) {
    const { data: membership } = await service
      .from('band_members')
      .select('role')
      .eq('band_id', ent.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership) authorized = true;
  }
  if (!authorized) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  // Also: the session can't extend past the entitlement's ends_at.
  if (endDate > new Date(ent.ends_at)) {
    return NextResponse.json(
      { error: `Session ends after your package expires (${fmtStampDate(ent.ends_at)}).` },
      { status: 400 },
    );
  }

  // ── Check + reserve balance ──────────────────────────────────────
  // Find the studio_hours balance row. There's at most one per
  // entitlement (templates ban duplicates by convention).
  const { data: balRow } = await service
    .from('package_entitlement_balances')
    .select('id, quantity_granted, quantity_redeemed, redemptions')
    .eq('entitlement_id', entitlementId)
    .eq('kind', 'studio_hours')
    .maybeSingle();
  if (!balRow) {
    return NextResponse.json({ error: 'No studio hours in this package.' }, { status: 400 });
  }
  type Bal = { id: string; quantity_granted: number; quantity_redeemed: number; redemptions: Array<Record<string, unknown>> };
  const bal = balRow as Bal;
  const remaining = bal.quantity_granted - bal.quantity_redeemed;
  if (durationHours > remaining) {
    return NextResponse.json(
      { error: `You only have ${remaining} hour${remaining === 1 ? '' : 's'} left — book a ${remaining}-hour session or wait for an add-on.` },
      { status: 400 },
    );
  }

  // ── Look up customer profile for booking row ─────────────────────
  const { data: profile } = await service
    .from('profiles')
    .select('display_name, email')
    .eq('user_id', user.id)
    .maybeSingle();
  const customerName = (profile as { display_name: string | null; email: string | null } | null)?.display_name
    ?? user.email.split('@')[0]
    ?? 'Customer';
  const customerEmail = (profile as { email: string | null } | null)?.email ?? user.email;

  // ── Insert booking row ───────────────────────────────────────────
  // status='confirmed' because the prepaid balance covers the cost —
  // no deposit needed, no Stripe round-trip.
  const { data: bookingInsert, error: bookErr } = await service
    .from('bookings')
    .insert({
      customer_name: customerName,
      customer_email: customerEmail,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      duration: durationHours,
      deposit_amount: 0,
      total_amount: 0,
      remainder_amount: 0,
      status: 'confirmed',
      room: 'studio_b',
      requested_engineer: body.requested_engineer ?? null,
      band_id: ent.band_id,
      package_entitlement_id: entitlementId,
      created_by_email: customerEmail,
      sales_tax_cents: 0,
      setup_minutes_before: 0,
      admin_notes: `Redeemed via package entitlement ${entitlementId}. ${durationHours}hr@$0 (prepaid).${body.notes ? `\n\nCustomer notes: ${body.notes}` : ''}`,
    })
    .select('id')
    .single();
  if (bookErr || !bookingInsert) {
    console.error('[redeem-session] booking insert:', bookErr);
    return NextResponse.json({ error: bookErr?.message ?? 'Booking insert failed' }, { status: 500 });
  }
  const bookingId = (bookingInsert as { id: string }).id;

  // ── Tick down balance + append redemption record ─────────────────
  // We use a SELECT-then-UPDATE rather than a true transaction since
  // the Supabase JS client doesn't expose transactions. Race window
  // is tiny (single user double-clicking) and the CHECK constraint
  // on quantity_redeemed <= quantity_granted catches over-redemption.
  const newRedemptions = [
    ...(bal.redemptions ?? []),
    {
      booking_id: bookingId,
      hours: durationHours,
      redeemed_at: new Date().toISOString(),
    },
  ];
  const { error: balUpdateErr } = await service
    .from('package_entitlement_balances')
    .update({
      quantity_redeemed: bal.quantity_redeemed + durationHours,
      redemptions: newRedemptions,
    })
    .eq('id', bal.id);
  if (balUpdateErr) {
    // Roll back the booking — better to fail clean than leave a
    // booking that didn't decrement the balance.
    console.error('[redeem-session] balance update failed; rolling back booking:', balUpdateErr);
    await service.from('bookings').delete().eq('id', bookingId);
    return NextResponse.json({ error: balUpdateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    booking_id: bookingId,
    hours_redeemed: durationHours,
    hours_remaining: remaining - durationHours,
  });
}
