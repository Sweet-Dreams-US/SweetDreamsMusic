// app/api/media/credits/book/route.ts
//
// Phase E credit-redemption booking flow. Creates a `bookings` row with
// $0 total/deposit/remainder, plus a `studio_credit_redemptions` row that
// links the booking to the credit being drawn down. The user's credit
// balance is decremented atomically (best-effort — see note below).
//
// Critical design rule from the spec: this endpoint MUST NOT modify the
// existing `/book` flow. We write to `bookings` directly using its
// existing schema; the new behavior is signalled by:
//   - total_amount = 0 (no money changes hands)
//   - admin_notes contains "credit_redemption:<credit_id>"
//   - a row exists in studio_credit_redemptions linking the two
//
// Engineer payout flow downstream: an engineer who claims/works a
// credit-redemption booking gets paid from the cost basis already
// recognized in the credit row, not from the booking's total_amount
// (which is $0). The Engineer-Accounting view's existing 60% split rule
// would treat this as $0 work — so admin pays out separately or we
// extend the accounting logic in Phase E.2. Documented as a known gap.
//
// Atomicity: Postgres doesn't have multi-statement transactions across
// these three operations from the JS client. We sequence them carefully:
//   1. Insert booking (own ID)
//   2. Insert redemption (links to booking ID + credit ID)
//   3. UPDATE studio_credits SET hours_used = hours_used + N WHERE id = credit_id AND hours_used + N <= hours_granted
//      (CHECK constraint blocks overdraw at the DB layer)
// If step 3 fails (overdraw or concurrent drain), we attempt to delete the
// booking + redemption to avoid orphaned rows. Worst case: a stuck booking
// row that admin can clean up — better than a credit going negative.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { paidBookingStatus } from '@/lib/booking-status';
import { getUserBands } from '@/lib/bands-server';
import { ENGINEERS, type Room } from '@/lib/constants';
import { getStudioConfig } from '@/lib/studio-config-server';
import { priceSessionFromConfig } from '@/lib/studio-config';
import { sendEngineerNewBookingAlert } from '@/lib/email';

const VALID_ROOMS: Room[] = ['studio_a', 'studio_b'];

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  // ── Parse + validate input ──────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const creditId = String(body.credit_id || '').trim();
  const date = String(body.date || '').trim(); // YYYY-MM-DD
  const startTime = String(body.start_time || '').trim(); // HH:MM
  const durationHoursRaw = Number(body.duration_hours);
  const room = String(body.room || '').trim() as Room;
  const engineerName = String(body.engineer_name || '').trim();
  const customerNote = body.notes ? String(body.notes).trim() : null;

  if (!creditId) return NextResponse.json({ error: 'credit_id required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    return NextResponse.json({ error: 'start_time must be HH:MM' }, { status: 400 });
  }
  // Credit-redemption flow constrains to whole hours by design — credits
  // are sold in 1-hour units and partial redemption would complicate the
  // ledger. (Note: `bookings.duration` itself is now numeric(5,2) per
  // migration 059 — engineers can record fractional time after the fact
  // via the Edit Time editor. This input restriction is per-flow, not
  // per-column.)
  if (
    !Number.isFinite(durationHoursRaw) ||
    durationHoursRaw < 1 ||
    durationHoursRaw > 12 ||
    !Number.isInteger(durationHoursRaw)
  ) {
    return NextResponse.json(
      { error: 'duration_hours must be a whole number between 1 and 12' },
      { status: 400 },
    );
  }
  if (!VALID_ROOMS.includes(room)) {
    return NextResponse.json({ error: 'Invalid room' }, { status: 400 });
  }
  if (!engineerName) {
    return NextResponse.json({ error: 'engineer_name required' }, { status: 400 });
  }
  const engineerEntry = ENGINEERS.find((e) => e.name === engineerName);
  if (!engineerEntry) {
    return NextResponse.json({ error: 'Unknown engineer' }, { status: 400 });
  }
  if (!engineerEntry.studios.includes(room)) {
    return NextResponse.json(
      { error: `${engineerEntry.displayName} doesn't work out of ${room.replace('_', ' ')}` },
      { status: 400 },
    );
  }

  // Already validated to be a whole-hour integer above.
  const durationHours = durationHoursRaw;

  // ── Validate credit ownership + balance ─────────────────────────────
  const service = createServiceClient();
  const { data: credit, error: creditErr } = await service
    .from('studio_credits')
    .select('id, user_id, band_id, hours_granted, hours_used')
    .eq('id', creditId)
    .maybeSingle();
  if (creditErr || !credit) {
    return NextResponse.json({ error: 'Credit not found' }, { status: 404 });
  }
  const creditRow = credit as {
    id: string;
    user_id: string | null;
    band_id: string | null;
    hours_granted: number;
    hours_used: number;
  };

  // Personal credit → user must own. Band credit → user must be a member.
  if (creditRow.user_id && creditRow.user_id !== user.id) {
    return NextResponse.json({ error: 'Not your credit' }, { status: 403 });
  }
  if (creditRow.band_id) {
    const memberships = await getUserBands(user.id);
    if (!memberships.some((m) => m.band_id === creditRow.band_id)) {
      return NextResponse.json({ error: 'Not in that band' }, { status: 403 });
    }
  }

  const remaining = Number(creditRow.hours_granted) - Number(creditRow.hours_used);
  if (durationHours > remaining) {
    return NextResponse.json(
      { error: `Only ${remaining.toFixed(1)} hours available — pick a shorter session` },
      { status: 400 },
    );
  }

  // ── Compute time window ─────────────────────────────────────────────
  // Database stores LOCAL Fort Wayne time as ISO without TZ shift — see
  // app/api/booking/availability/route.ts for the convention. We mirror it.
  const startISO = `${date}T${startTime}:00`;
  const startMs = new Date(startISO).getTime();
  if (Number.isNaN(startMs)) {
    return NextResponse.json({ error: 'Invalid start datetime' }, { status: 400 });
  }
  const endISO = new Date(startMs + durationHours * 60 * 60 * 1000).toISOString().slice(0, 19);

  // ── Conflict check ──────────────────────────────────────────────────
  // Two checks: (a) any existing booking in the same room overlaps,
  // (b) the engineer is busy with another studio booking OR media session.
  // This mirrors the conflict logic in lib/media-scheduling-server.ts but
  // we re-implement here to keep the credit flow self-contained. Both
  // queries use half-open interval overlap: A overlaps B iff A.start < B.end
  // AND B.start < A.end.
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;

  const [{ data: roomBookings }, { data: engBookings }, { data: mediaSessions }] = await Promise.all([
    service
      .from('bookings')
      .select('id, start_time, end_time, duration, status')
      .eq('room', room)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .not('status', 'in', '(cancelled)'),
    service
      .from('bookings')
      .select('id, start_time, end_time, duration, status')
      .eq('engineer_name', engineerName)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .not('status', 'in', '(cancelled)'),
    service
      .from('media_session_bookings')
      .select('id, starts_at, ends_at, status, engineer_id')
      .lt('starts_at', endISO)
      .gt('ends_at', startISO)
      .neq('status', 'cancelled'),
  ]);

  const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
    new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

  for (const b of (roomBookings || []) as Array<{ start_time: string; end_time: string | null; duration: number }>) {
    const bEnd = b.end_time || new Date(new Date(b.start_time).getTime() + b.duration * 3600000).toISOString();
    if (overlaps(startISO, endISO, b.start_time, bEnd)) {
      return NextResponse.json(
        { error: `${room.replace('_', ' ')} is booked during that time — pick another slot.` },
        { status: 409 },
      );
    }
  }
  for (const b of (engBookings || []) as Array<{ start_time: string; end_time: string | null; duration: number }>) {
    const bEnd = b.end_time || new Date(new Date(b.start_time).getTime() + b.duration * 3600000).toISOString();
    if (overlaps(startISO, endISO, b.start_time, bEnd)) {
      return NextResponse.json(
        { error: `${engineerEntry.displayName} is in another studio session at that time.` },
        { status: 409 },
      );
    }
  }
  // For media sessions, resolve engineer_id → name and skip non-matching engineers.
  // Engineer entries have an email; profiles tie email to user_id.
  const { data: engineerProfile } = await service
    .from('profiles')
    .select('user_id')
    .ilike('email', engineerEntry.email)
    .maybeSingle();
  const engineerUserId = (engineerProfile as { user_id?: string } | null)?.user_id;
  if (engineerUserId) {
    for (const m of (mediaSessions || []) as Array<{ engineer_id: string; starts_at: string; ends_at: string }>) {
      if (m.engineer_id === engineerUserId) {
        return NextResponse.json(
          { error: `${engineerEntry.displayName} has a media session at that time.` },
          { status: 409 },
        );
      }
    }
  }

  // ── Buyer profile (for the booking's customer fields) ──────────────
  const { data: buyerProfile } = await service
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .maybeSingle();
  const buyerName =
    (buyerProfile as { display_name?: string } | null)?.display_name ||
    user.email.split('@')[0] ||
    'Customer';

  // Value the work so the engineer is PAID for a $0 (prepaid/credit) session.
  // service_value_cents = what these hours are normally worth; computeEarnings
  // pays the engineer 60% of this even though total_amount is $0. (Fixes the
  // long-standing $0-payout gap on credit sessions.) Surcharges included in value.
  const startHour = new Date(startISO).getUTCHours();
  let serviceValueCents = 0;
  try {
    const cfg = await getStudioConfig(service, room);
    serviceValueCents = priceSessionFromConfig(cfg, { hours: durationHours, startHour, sameDay: false, guests: 1 }).total;
  } catch { serviceValueCents = 0; }

  // If this credit was ISSUED by a reward, tag the booking with that grant so the
  // per-booking accounting + Business view tie out (and a cancel can restore it).
  let rewardGrantId: string | null = null;
  try {
    const { data: srcGrant } = await service.from('reward_grants').select('id').eq('issued_ref', `studio_credits:${creditRow.id}`).maybeSingle();
    rewardGrantId = (srcGrant as { id: string } | null)?.id ?? null;
  } catch { rewardGrantId = null; }

  // ── Insert booking row ──────────────────────────────────────────────
  const { data: newBooking, error: bookErr } = await service
    .from('bookings')
    .insert({
      customer_name: buyerName,
      customer_email: user.email,
      start_time: startISO,
      end_time: endISO,
      duration: durationHours,
      room,
      engineer_name: engineerName,
      requested_engineer: engineerName,
      total_amount: 0,
      service_value_cents: serviceValueCents,
      deposit_amount: 0,
      remainder_amount: 0,
      actual_deposit_paid: 0,
      // Customer picked the engineer at redemption (required) → born 'confirmed'.
      status: paidBookingStatus(engineerName),
      // Tag the booking so admin can spot credit-funded sessions at a glance.
      // Format mirrors the convention used elsewhere for system-generated tags.
      admin_notes: `credit_redemption:${creditRow.id}${customerNote ? ` · ${customerNote}` : ''}`,
      band_id: creditRow.band_id ?? null,
      reward_grant_id: rewardGrantId,
    })
    .select('id')
    .single();

  if (bookErr || !newBooking) {
    console.error('[media/credits/book] booking insert error:', bookErr);
    return NextResponse.json({ error: 'Could not create booking' }, { status: 500 });
  }
  const bookingId = (newBooking as { id: string }).id;

  // ── Insert redemption row + decrement credit ────────────────────────
  // We split this into two writes. If the credit decrement fails (overdraw,
  // concurrent drain), we delete the booking + redemption to avoid orphans.
  const { error: redemptionErr } = await service
    .from('studio_credit_redemptions')
    .insert({
      credit_id: creditRow.id,
      studio_booking_id: bookingId,
      hours_redeemed: durationHours,
      redeemed_by: user.id,
    });
  if (redemptionErr) {
    console.error('[media/credits/book] redemption insert error:', redemptionErr);
    // Roll back the booking — best effort
    await service.from('bookings').delete().eq('id', bookingId);
    return NextResponse.json({ error: 'Could not record redemption' }, { status: 500 });
  }

  // Decrement using the CHECK constraint (hours_used <= hours_granted) as
  // our overdraw guard. If a concurrent redemption snuck in, the constraint
  // blocks the update and we roll back the redemption + booking.
  const { error: drainErr } = await service
    .from('studio_credits')
    .update({ hours_used: Number(creditRow.hours_used) + durationHours })
    .eq('id', creditRow.id)
    .eq('hours_used', creditRow.hours_used); // Optimistic concurrency
  if (drainErr) {
    console.error('[media/credits/book] credit drain error:', drainErr);
    // Roll back redemption + booking
    await service.from('studio_credit_redemptions')
      .delete()
      .eq('studio_booking_id', bookingId);
    await service.from('bookings').delete().eq('id', bookingId);
    return NextResponse.json(
      { error: 'Credit balance changed during booking — try again.' },
      { status: 409 },
    );
  }

  // ── Engineer alert (fire-and-forget) ───────────────────────────────
  // Reusing sendEngineerNewBookingAlert keeps the engineer's inbox uniform
  // — they see studio bookings the same way regardless of payment source.
  try {
    await sendEngineerNewBookingAlert([engineerEntry.email], {
      id: bookingId,
      customerName: buyerName,
      date: new Date(startISO).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      startTime: new Date(startISO).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      duration: durationHours,
      room,
    });
  } catch (e) {
    console.error('[media/credits/book] engineer alert error:', e);
  }

  return NextResponse.json({
    ok: true,
    booking_id: bookingId,
    hours_redeemed: durationHours,
    hours_remaining: remaining - durationHours,
  });
}
