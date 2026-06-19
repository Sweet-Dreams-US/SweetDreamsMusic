// app/api/media/credits/book/route.ts
//
// Free-studio-hour credit-redemption booking flow.
//
// MONEY MODEL (reworked 2026-06 — was hard-coded $0):
//   A free studio hour discounts ONE hour of BASE studio time (room-aware,
//   capped at the booked hours). The customer still pays the FULL surcharge
//   (late-night / deep-night / same-day / guests) up front by card, plus —
//   for 2+ hour bookings — the discounted half of the deposit. The exact
//   cents math lives in lib/credit-redemption-pricing.ts (pure, self-checked
//   against four worked examples).
//
//   Two payment paths fall out of that math:
//     • amountDueNow > 0  → create the booking PENDING + send the customer to
//       Stripe Checkout for exactly amountDueNow, reusing the SAME machinery
//       the paid /book flow uses (stripe.checkout.sessions.create + the
//       booking webhook). The webhook confirms the booking AND decrements the
//       credit — so an abandoned checkout NEVER consumes the free hour.
//     • amountDueNow == 0 → nothing to charge, so confirm instantly + decrement
//       the credit right here (the legacy no-Stripe path).
//
// What we record on the booking row:
//   - total_amount   = netTotal (total − discount), the customer's net cost
//   - deposit_amount = amountDueNow (what's collected up front)
//   - remainder_amount = remainder (owed after the session)
//   - discount_amount = the free-hour discount, with admin_notes carrying
//     "free_hour_credit:<creditId>" so admin can spot credit-funded sessions
//   - service_value_cents = FULL base session value (engineer payout basis),
//     unchanged from before so the engineer is still paid on the real value.
//
// CRITICAL BUG FIX: the surcharge time-tier now uses the studio-LOCAL (Eastern)
// hour. The old code did `new Date(startISO).getUTCHours()` which, because
// startISO is a zone-naive "YYYY-MM-DDTHH:MM:00" parsed as the server's local
// time and then read back as UTC, shifted the hour by the server's offset
// (11pm ET read as deep-night). startTime is ALREADY the Eastern wall clock the
// user picked, so parseTimeSlot(startTime) is the correct local decimal hour —
// the same derivation /api/booking/create uses.
//
// Atomicity (instant-confirm path): same careful sequencing as before —
//   1. Insert booking
//   2. Insert redemption (links booking + credit)
//   3. UPDATE studio_credits hours_used += creditHoursApplied with an
//      optimistic-concurrency guard (CHECK constraint blocks overdraw)
// On a later-step failure we roll back the earlier rows.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { paidBookingStatus } from '@/lib/booking-status';
import { getUserBands } from '@/lib/bands-server';
import { ENGINEERS, PRICING, SITE_URL, ROOM_LABELS, type Room } from '@/lib/constants';
import { getStudioConfig } from '@/lib/studio-config-server';
import { parseTimeSlot, formatDuration } from '@/lib/utils';
import { computeCreditRedemptionPricing } from '@/lib/credit-redemption-pricing';
import { sendEngineerNewBookingAlert } from '@/lib/email';

const VALID_ROOMS: Room[] = ['studio_a', 'studio_b'];

/** Pad a wall-clock time so the hour is two digits ("9:00" → "09:00") — keeps
 *  `${date}T${time}:00` a valid ISO-8601 string for the webhook's date math.
 *  Mirrors the helper in /api/booking/create. Idempotent. */
const padClockHm = (t: string) => {
  const [h = '0', m = '00'] = String(t ?? '').split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
};

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

  // Credit hours remaining. NOTE: we no longer reject when the requested
  // duration exceeds the remaining credit — the credit only discounts
  // creditHoursApplied = min(remaining, bookedHours), and any extra hours are
  // simply paid for. So a 1-hour credit on a 3-hour booking discounts 1 hour
  // and charges the other two.
  const remaining = Number(creditRow.hours_granted) - Number(creditRow.hours_used);
  if (remaining <= 0) {
    return NextResponse.json(
      { error: 'This wallet has no hours left.' },
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

  // ── Surcharge-aware pricing (Eastern hour — see header bug-fix note) ──
  // startTime is the Eastern wall clock the user picked, so parseTimeSlot gives
  // the correct studio-LOCAL decimal hour. (Old code used getUTCHours() on a
  // zone-naive Date, shifting the surcharge tier by the server's offset.)
  const startHourLocal = parseTimeSlot(startTime);
  // Same-day is computed in Fort Wayne time (Vercel runs UTC), mirroring
  // /api/booking/create so a 9pm-ET booking made the same calendar day is
  // correctly flagged regardless of the server's clock.
  const todayLocal = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Indiana/Indianapolis',
  });
  const sameDay = date === todayLocal;

  const cfg = await getStudioConfig(service, room);
  const pricing = computeCreditRedemptionPricing({
    room,
    hours: durationHours,
    startHourLocal,
    sameDay,
    guestCount: 0, // credit redemptions don't take a guest count today; default solo
    creditHoursRemaining: remaining,
    pricing: cfg,
  });

  // service_value_cents = what these hours are normally worth (FULL session
  // value, surcharges incl.) so the engineer is still paid 60% of the real
  // value even though the customer's net cost is lower. computeEarnings reads
  // this, NOT total_amount.
  const serviceValueCents = pricing.total;

  // If this credit was ISSUED by a reward, tag the booking with that grant so the
  // per-booking accounting + Business view tie out (and a cancel can restore it).
  let rewardGrantId: string | null = null;
  try {
    const { data: srcGrant } = await service.from('reward_grants').select('id').eq('issued_ref', `studio_credits:${creditRow.id}`).maybeSingle();
    rewardGrantId = (srcGrant as { id: string } | null)?.id ?? null;
  } catch { rewardGrantId = null; }

  // admin_notes carries BOTH the legacy redemption tag (so existing tooling
  // that greps "credit_redemption:" keeps working) AND the spec-requested
  // "free_hour_credit:<creditId>" marker for the surcharge-aware flow.
  const adminNotes =
    `credit_redemption:${creditRow.id} · free_hour_credit:${creditRow.id}` +
    `${customerNote ? ` · ${customerNote}` : ''}`;

  const hoursToDecrement = pricing.creditHoursApplied;

  // ════════════════════════════════════════════════════════════════════
  // PATH A — money is due now (amountDueNow > 0). Create the booking PENDING,
  // hand the customer to Stripe Checkout for exactly amountDueNow, and let the
  // webhook confirm + decrement the credit on successful payment. An abandoned
  // checkout therefore NEVER consumes the free hour. Reuses the EXACT Stripe
  // machinery + webhook the paid /book flow uses (stripe.checkout.sessions
  // .create → booking webhook).
  // ════════════════════════════════════════════════════════════════════
  if (pricing.amountDueNow > 0) {
    // Insert the booking as PENDING (no engineer assigned to the row yet — it's
    // unconfirmed until payment lands, same as the paid deposit flow). The
    // chosen engineer is preserved in requested_engineer so the webhook can
    // confirm + alert them. We do NOT insert the redemption or decrement the
    // credit here — that's the webhook's job, payment-gated.
    const { data: pendingBooking, error: pendErr } = await service
      .from('bookings')
      .insert({
        customer_name: buyerName,
        customer_email: user.email,
        start_time: startISO,
        end_time: endISO,
        duration: durationHours,
        room,
        engineer_name: null,
        requested_engineer: engineerName,
        total_amount: pricing.netTotal,
        service_value_cents: serviceValueCents,
        deposit_amount: pricing.amountDueNow,
        remainder_amount: pricing.remainder,
        // The free-hour discount is recorded as the gap between service_value_cents
        // (full value) and total_amount (netTotal) — same convention as the paid
        // reward-discount flow (migration 067). The "free_hour_credit:<id>" tag in
        // admin_notes makes it explicit + auditable. There is no discount_amount
        // column on bookings.
        actual_deposit_paid: 0,
        status: 'pending', // confirmed by the webhook on payment
        admin_notes: adminNotes,
        band_id: creditRow.band_id ?? null,
        reward_grant_id: rewardGrantId,
      })
      .select('id')
      .single();

    if (pendErr || !pendingBooking) {
      console.error('[media/credits/book] pending booking insert error:', pendErr);
      return NextResponse.json({ error: 'Could not start booking' }, { status: 500 });
    }
    const bookingId = (pendingBooking as { id: string }).id;

    // Find or create the Stripe customer (same as /api/booking/create).
    let customerId: string;
    try {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        const customer = await stripe.customers.create({ email: user.email, name: buyerName });
        customerId = customer.id;
      }

      const roomLabel = ROOM_LABELS[room] || room;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: PRICING.currency,
              product_data: {
                name: `Studio Session — ${roomLabel} (free-hour credit)`,
                description:
                  `${formatDuration(durationHours)} on ${date} at ${startTime} · ` +
                  `1 free hour applied (−$${(pricing.discount / 100).toFixed(2)})`,
              },
              unit_amount: pricing.amountDueNow,
            },
            quantity: 1,
          },
        ],
        payment_method_options: {
          card: { setup_future_usage: 'off_session' },
        },
        success_url: `${SITE_URL}/book/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/dashboard/media/credits`,
        metadata: {
          // The webhook branches on this discriminator. It confirms the booking
          // AND decrements the credit (payment-gated, idempotent).
          type: 'credit_redemption_deposit',
          booking_id: bookingId,
          credit_id: creditRow.id,
          credit_hours_applied: String(hoursToDecrement),
          redeemed_by: user.id,
          engineer: engineerName,
          customer_name: buyerName,
          customer_email: user.email,
          session_date: date,
          start_time: padClockHm(startTime),
          duration_hours: String(durationHours),
          room,
        },
      });

      // Stash the checkout session id so the webhook + admin can correlate.
      await service
        .from('bookings')
        .update({ stripe_customer_id: customerId, stripe_checkout_session_id: session.id })
        .eq('id', bookingId);

      return NextResponse.json({
        ok: true,
        booking_id: bookingId,
        requires_payment: true,
        amount_due_now: pricing.amountDueNow,
        discount: pricing.discount,
        net_total: pricing.netTotal,
        remainder: pricing.remainder,
        credit_hours_applied: hoursToDecrement,
        checkout_url: session.url,
      });
    } catch (e) {
      // Stripe failed — roll back the pending booking so we don't leave an
      // orphaned unpaid row. The credit was never touched.
      console.error('[media/credits/book] stripe checkout error — rolling back:', e);
      await service.from('bookings').delete().eq('id', bookingId);
      return NextResponse.json({ error: 'Could not start payment. Try again.' }, { status: 500 });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PATH B — nothing due now (amountDueNow == 0). Confirm instantly + decrement
  // the credit right here, no Stripe. This is the original no-money path, kept
  // intact (insert booking → insert redemption → optimistic-concurrency drain).
  // ════════════════════════════════════════════════════════════════════
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
      total_amount: pricing.netTotal, // 0 when fully credit-covered
      service_value_cents: serviceValueCents,
      deposit_amount: pricing.amountDueNow, // 0
      remainder_amount: pricing.remainder, // 0
      // Discount recorded as service_value_cents − total_amount (see PATH A note).
      actual_deposit_paid: 0,
      // Customer picked the engineer at redemption (required) → born 'confirmed'.
      status: paidBookingStatus(engineerName),
      admin_notes: adminNotes,
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
      hours_redeemed: hoursToDecrement,
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
    .update({ hours_used: Number(creditRow.hours_used) + hoursToDecrement })
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
    requires_payment: false,
    amount_due_now: 0,
    discount: pricing.discount,
    net_total: pricing.netTotal,
    remainder: pricing.remainder,
    credit_hours_applied: hoursToDecrement,
    hours_redeemed: hoursToDecrement,
    hours_remaining: remaining - hoursToDecrement,
  });
}
