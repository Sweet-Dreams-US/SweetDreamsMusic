import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { stripe } from '@/lib/stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getStudioConfig } from '@/lib/studio-config-server';
import { sweetSpotAddonCents } from '@/lib/studio-config';
import { markGrantRedeemed, redeemBeatDiscountUse } from '@/lib/rewards-issue';
import { BEAT_EXCLUSIVE_DISCOUNT_MAX_USES } from '@/lib/rewards';
import { paidBookingStatus } from '@/lib/booking-status';
import {
  sendBookingConfirmation,
  sendAdminBookingAlert,
  sendEngineerNewBookingAlert,
  sendEngineerPriorityAlert,
  sendMediaPurchaseConfirmation,
  sendMediaPurchaseAdminAlert,
  sendPackageQuoteAccepted,
} from '@/lib/email';
import { mintEntitlementFromQuote, extendEntitlement } from '@/lib/packages-mint';
import { ENGINEERS, SUPER_ADMINS, SITE_URL, type Room } from '@/lib/constants';
import { loadEngineers } from '@/lib/engineers-server';
import { calculatePriorityExpiry, getPriorityHoursLabel, calculateRescheduleDeadline } from '@/lib/priority';
import { awardXP } from '@/lib/xp-system';
import { fmtSessionDate, fmtSessionTime, fmtStampDate } from '@/lib/studio-time';
import { creditGrantsFromOffering } from '@/lib/media-credits';
import type { MediaOffering } from '@/lib/media';
import type { ConfiguredComponents } from '@/lib/media-config';
import type Stripe from 'stripe';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Pad a wall-clock "H:MM" time so the hour is always two digits ("9:00" →
 * "09:00"). An unpadded hour makes `${date}T${time}:00` an INVALID ISO-8601
 * string, so `new Date(...)` is Invalid Date and any downstream `.toISOString()`
 * (priority window, reschedule deadline, email formatting) throws
 * "RangeError: Invalid time value" — which silently lost a paid booking
 * (incident 2026-06-06: a 9:00 AM Studio B session, charged but never created).
 * Older /create deploys wrote the unpadded form into Stripe metadata, so we
 * normalize defensively on read here. Idempotent on already-padded values.
 */
function padClockHm(t: string | undefined | null): string {
  const [h = '0', m = '00'] = String(t ?? '').split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/**
 * Best-effort admin alert when the webhook handler fails after a payment
 * has succeeded. Customer's card was charged but no booking row exists
 * — admin must intervene manually before retrying. We swallow any
 * delivery error so an email outage doesn't compound the original
 * webhook failure.
 */
async function alertAdminOfWebhookFailure(args: {
  eventId: string;
  eventType: string;
  reason: string;
  metadata?: Record<string, string>;
  paymentIntent?: string | null;
  amount?: number | null;
}) {
  try {
    const metaLines = args.metadata
      ? Object.entries(args.metadata)
          .filter(([k]) => !k.startsWith('cart_part_')) // big nested cart is noisy
          .map(([k, v]) => `<li><strong>${k}</strong>: ${String(v).slice(0, 200)}</li>`)
          .join('')
      : '';
    await resend.emails.send({
      from: 'Sweet Dreams Music <studio@sweetdreamsmusic.com>',
      to: [...SUPER_ADMINS],
      subject: `🚨 WEBHOOK FAILURE — ${args.eventType} (${args.eventId.slice(0, 16)})`,
      html: `
        <h2 style="color:#cc0000">Stripe webhook handler failed</h2>
        <p><strong>Event:</strong> ${args.eventId} (${args.eventType})</p>
        <p><strong>Reason:</strong> ${args.reason}</p>
        ${args.paymentIntent ? `<p><strong>Payment intent:</strong> ${args.paymentIntent}</p>` : ''}
        ${args.amount != null ? `<p><strong>Amount:</strong> $${(args.amount / 100).toFixed(2)}</p>` : ''}
        ${metaLines ? `<p><strong>Metadata:</strong></p><ul>${metaLines}</ul>` : ''}
        <p style="background:#fff3cd;padding:10px;border-left:3px solid #cc0000">
          The customer was charged but no booking/order was created.
          Check Vercel logs and Stripe dashboard, then create the
          missing row manually + send confirmation.
        </p>
        <p><a href="https://dashboard.stripe.com/events/${args.eventId}">View on Stripe</a> · <a href="${SITE_URL}/admin">Open admin</a></p>
      `,
    });
  } catch (e) {
    console.error('[webhook] admin alert send failed (swallowed):', e);
  }
}

/**
 * Complete a free-studio-hour credit redemption once its surcharge/deposit
 * payment has landed (fires from BOTH checkout.session.completed for cards and
 * checkout.session.async_payment_succeeded for Cash App / bank transfers, which
 * is why it's factored out).
 *
 * The credit-redemption API (app/api/media/credits/book) already inserted a
 * PENDING booking and charged amountDueNow. Here we, idempotently:
 *   1. Confirm the booking (engineer was chosen at redemption → 'confirmed').
 *   2. Insert the studio_credit_redemptions linkage — exactly once.
 *   3. Decrement the credit by credit_hours_applied (PAYMENT-GATED, so an
 *      abandoned checkout never consumes the free hour; optimistic-concurrency
 *      guard + DB CHECK constraint block overdraw).
 *   4. Alert the engineer.
 *
 * Returns { retry: true } when the caller should roll back the idempotency claim
 * so Stripe re-delivers (transient: booking row not yet visible). Returns
 * { retry: false } on success OR permanently-bad metadata (ACK + admin-alert).
 */
async function completeCreditRedemption(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  eventId: string,
  eventType: string,
): Promise<{ retry: boolean }> {
  const bookingId = meta.booking_id;
  const creditId = meta.credit_id;
  const creditHoursApplied = parseInt(meta.credit_hours_applied || '0', 10);
  const redeemedBy = meta.redeemed_by || null;

  if (!bookingId || !creditId) {
    console.error('[webhook][credit_redemption] missing booking_id/credit_id', meta);
    await alertAdminOfWebhookFailure({
      eventId,
      eventType,
      reason: 'credit_redemption_deposit missing booking_id or credit_id',
      metadata: meta,
      paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      amount: session.amount_total,
    });
    return { retry: false }; // permanently bad — ACK, don't retry forever
  }

  const { data: pendingRow } = await supabase
    .from('bookings')
    .select('id, requested_engineer, engineer_name, room, customer_name, customer_email, start_time, duration, status, actual_deposit_paid')
    .eq('id', bookingId)
    .maybeSingle();
  type CRBooking = {
    id: string;
    requested_engineer: string | null;
    engineer_name: string | null;
    room: string | null;
    customer_name: string | null;
    customer_email: string | null;
    start_time: string;
    duration: number;
    status: string;
    actual_deposit_paid: number | null;
  };
  const crBooking = pendingRow as CRBooking | null;

  if (!crBooking) {
    // The pending booking should exist (the API inserted it before checkout).
    // If it's missing, the row may still be replicating — ask Stripe to retry.
    console.error('[webhook][credit_redemption] booking not found — retry', bookingId);
    return { retry: true };
  }

  const engineerName = crBooking.requested_engineer || meta.engineer || null;

  // 1. Confirm + stamp payment (idempotent: re-running writes the same values).
  await supabase
    .from('bookings')
    .update({
      engineer_name: engineerName,
      status: paidBookingStatus(engineerName),
      actual_deposit_paid: session.amount_total,
      stripe_customer_id: session.customer as string,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent as string,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  // 2 + 3. Insert redemption + decrement credit ONCE. If a redemption row
  // already exists (replay / both sync+async fired), skip both so the free
  // hour is never double-consumed.
  const { data: existingRedemption } = await supabase
    .from('studio_credit_redemptions')
    .select('id')
    .eq('studio_booking_id', bookingId)
    .maybeSingle();

  if (!existingRedemption && creditHoursApplied > 0) {
    const { error: redErr } = await supabase
      .from('studio_credit_redemptions')
      .insert({
        credit_id: creditId,
        studio_booking_id: bookingId,
        hours_redeemed: creditHoursApplied,
        redeemed_by: redeemedBy,
      });
    if (redErr) {
      console.error('[webhook][credit_redemption] redemption insert failed:', redErr);
    } else {
      const { data: creditRow } = await supabase
        .from('studio_credits')
        .select('hours_used, hours_granted')
        .eq('id', creditId)
        .maybeSingle();
      const cr = creditRow as { hours_used: number; hours_granted: number } | null;
      if (cr) {
        const { error: drainErr } = await supabase
          .from('studio_credits')
          .update({ hours_used: Number(cr.hours_used) + creditHoursApplied })
          .eq('id', creditId)
          .eq('hours_used', cr.hours_used); // optimistic concurrency
        if (drainErr) {
          console.error('[webhook][credit_redemption] credit drain failed:', drainErr);
          await alertAdminOfWebhookFailure({
            eventId,
            eventType,
            reason: `credit drain failed for credit ${creditId} (booking ${bookingId}); payment succeeded — reconcile hours manually`,
            metadata: meta,
            paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
            amount: session.amount_total,
          });
        }
      }
    }
  }

  // 4. Engineer alert (fire-and-forget).
  try {
    const eng = ENGINEERS.find((e) => e.name === engineerName || e.displayName === engineerName);
    if (eng) {
      await sendEngineerNewBookingAlert([eng.email], {
        id: bookingId,
        customerName: crBooking.customer_name || 'Customer',
        date: fmtSessionDate(crBooking.start_time, { weekday: 'long', month: 'long', day: 'numeric' }),
        startTime: fmtSessionTime(crBooking.start_time),
        duration: crBooking.duration,
        room: crBooking.room || meta.room || '',
      });
    }
  } catch (e) {
    console.error('[webhook][credit_redemption] engineer alert error:', e);
  }

  console.log(
    `[webhook] credit_redemption_deposit processed: booking=${bookingId} credit=${creditId} hours=${creditHoursApplied} amount=${session.amount_total}`,
  );
  return { retry: false };
}

/**
 * Drain ONE free studio hour for a /book solo session that opted into the
 * free-hour discount at checkout (meta.free_hour_applied === '1'). Called from
 * the booking_deposit branch AFTER the booking row is confirmed, so it is
 * PAYMENT-GATED — an abandoned checkout never reaches here and the hour is
 * never consumed.
 *
 * Idempotent, mirroring completeCreditRedemption:
 *   1. Skip if a studio_credit_redemptions row already links this booking
 *      (replay / both sync+async fired).
 *   2. Insert the redemption linkage (1 hour).
 *   3. Increment studio_credits.hours_used by 1 with an optimistic-concurrency
 *      guard (.eq('hours_used', old)); the DB CHECK constraint blocks overdraw.
 *
 * All failures are non-fatal here — the booking is already confirmed and the
 * customer was charged the discounted amount. We log + alert on the rare drain
 * failure so admin can reconcile, but never roll back the paid booking.
 */
async function drainFreeHourForBooking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  args: {
    bookingId: string;
    creditId: string;
    redeemedBy: string | null;
    eventId: string;
    eventType: string;
    paymentIntent: string | null;
    amount: number | null;
    meta: Record<string, string>;
  },
): Promise<void> {
  const { bookingId, creditId, redeemedBy } = args;
  if (!bookingId || !creditId) return;

  try {
    const { data: existingRedemption } = await supabase
      .from('studio_credit_redemptions')
      .select('id')
      .eq('studio_booking_id', bookingId)
      .maybeSingle();
    if (existingRedemption) return; // already drained — idempotent no-op

    const { error: redErr } = await supabase
      .from('studio_credit_redemptions')
      .insert({
        credit_id: creditId,
        studio_booking_id: bookingId,
        hours_redeemed: 1,
        redeemed_by: redeemedBy,
      });
    if (redErr) {
      console.error('[webhook][free_hour] redemption insert failed:', redErr);
      return;
    }

    const { data: creditRow } = await supabase
      .from('studio_credits')
      .select('hours_used, hours_granted')
      .eq('id', creditId)
      .maybeSingle();
    const cr = creditRow as { hours_used: number; hours_granted: number } | null;
    if (!cr) return;
    const { error: drainErr } = await supabase
      .from('studio_credits')
      .update({ hours_used: Number(cr.hours_used) + 1 })
      .eq('id', creditId)
      .eq('hours_used', cr.hours_used); // optimistic concurrency
    if (drainErr) {
      console.error('[webhook][free_hour] credit drain failed:', drainErr);
      await alertAdminOfWebhookFailure({
        eventId: args.eventId,
        eventType: args.eventType,
        reason: `free-hour drain failed for credit ${creditId} (booking ${bookingId}); payment succeeded — reconcile hours manually`,
        metadata: args.meta,
        paymentIntent: args.paymentIntent,
        amount: args.amount,
      });
      return;
    }
    console.log(
      `[webhook] free_hour drained: booking=${bookingId} credit=${creditId} hours=1`,
    );
  } catch (e) {
    console.error('[webhook][free_hour] unexpected drain error (non-fatal):', e);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ── Idempotency claim ────────────────────────────────────────────────
  // Stripe retries webhooks on 5xx or network timeout. Without dedup, retries
  // can double-insert bookings / beat purchases, double-award XP, etc.
  // Claim the event.id via a unique-constraint INSERT. If it succeeds, we
  // own this delivery. If it fails with 23505 (unique_violation), another
  // handler has already processed (or is processing) this event — ACK and
  // skip. See migration 035 for design rationale.
  {
    const { error: claimErr } = await supabase
      .from('stripe_webhook_events')
      .insert({ event_id: event.id, event_type: event.type });

    if (claimErr) {
      if (claimErr.code === '23505') {
        console.log(`[webhook] duplicate delivery for event ${event.id} (${event.type}) — deduped`);
        return NextResponse.json({ received: true, deduped: true });
      }
      // Any other DB error means we can't guarantee dedup — return 5xx so
      // Stripe retries, but don't process (risk of double-side-effects).
      console.error('[webhook] claim insert failed:', claimErr);
      return NextResponse.json({ error: 'Dedup claim failed' }, { status: 500 });
    }
  }

  // ── Top-level safety net ─────────────────────────────────────────────
  // If anything in the switch handler throws an UNCAUGHT exception, we
  // rolled back the dedup claim and fire an admin alert so the customer
  // doesn't disappear into the void. This is the fix for the May 8-10
  // outage where 4 paid bookings were silently lost: the previous code
  // relied on each branch handling its own rollback, so an unhandled
  // throw stuck the claim and Stripe's retries were deduped to no-ops.
  try {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata || {};

      if (meta.type === 'booking_deposit' || meta.type === 'band_booking_deposit') {
        // Session booking deposit paid. Two flavors share this branch:
        //   - 'booking_deposit'       → solo session
        //   - 'band_booking_deposit'  → band session (has meta.band_id)
        // The only row-level difference is `band_id`; everything else
        // (emails, engineer notifications, XP) flows the same way because
        // the paying customer is still the booker, not the band.
        //
        // Special cases (band-only, both gated on meta.type === 'band_booking_deposit'):
        //   1) 24hr (3-day) block — fans out to 3 booking rows linked by
        //      a shared booking_group_id. Day 1 carries setup_minutes_before;
        //      days 2-3 don't.
        //   2) Sweet Spot filming add-on — extends the relevant day's
        //      duration by 2 hours and stamps sweet_spot_addon JSONB on
        //      that row. For 8hr the addon lives on the single row; for
        //      24hr it lives on the picked filming-day row.
        const startDateTime = `${meta.session_date}T${padClockHm(meta.start_time)}:00`;
        const endDateTime = `${meta.session_date}T${padClockHm(meta.end_time)}:00`;
        // duration_hours may be fractional (e.g. "1.5") once the engineer-edit
        // path lands — parseFloat keeps both integer and decimal shapes valid.
        const baseDurationHours = parseFloat(meta.duration_hours);
        const isBandBooking = meta.type === 'band_booking_deposit';
        const is3DayBlock = isBandBooking && baseDurationHours === 24;

        // Parse Sweet Spot add-on metadata (JSON-stringified by /create).
        // Shape after parse: { kind: '8hr-addon' } or { kind: '3day-addon', filmingDayIndex: 0|1|2 }.
        let sweetSpotAddon:
          | { kind: '8hr-addon'; price_cents: number; extra_filming_hours: number }
          | { kind: '3day-addon'; filmingDayIndex: 0 | 1 | 2; price_cents: number; extra_filming_hours: number }
          | null = null;
        if (meta.sweet_spot_addon) {
          try {
            const parsed = JSON.parse(meta.sweet_spot_addon);
            // Record the add-on price from config (admin-editable), consistent with
            // what /create charged. Fallback to the constant is inside the helper.
            const bandCfg = await getStudioConfig(supabase, 'studio_a');
            if (parsed?.kind === '8hr-addon') {
              sweetSpotAddon = { kind: '8hr-addon', price_cents: sweetSpotAddonCents(bandCfg, 8), extra_filming_hours: 2 };
            } else if (parsed?.kind === '3day-addon' && [0, 1, 2].includes(parsed.filmingDayIndex)) {
              sweetSpotAddon = {
                kind: '3day-addon',
                filmingDayIndex: parsed.filmingDayIndex,
                price_cents: sweetSpotAddonCents(bandCfg, 24),
                extra_filming_hours: 2,
              };
            }
          } catch (e) {
            // Sweet Spot is part of the priced deposit — silently dropping
            // it would mean the customer paid for an add-on with no row to
            // back it. Roll back the dedup claim so Stripe retries; if the
            // payload is permanently bad, admin investigates from logs.
            console.error('[webhook] sweet_spot_addon parse failed — rolling back claim:', e);
            await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
            return NextResponse.json({ error: 'Sweet Spot metadata corrupted' }, { status: 500 });
          }
        }

        // Calculate dynamic priority window: until 12 hours before session (min 2 hours from now).
        // Bands always carry a priority window — even if meta.engineer is somehow
        // empty (defense-in-depth) we want Iszac to get the priority claim, not
        // fall through to the all-engineers fan-out.
        const priorityExpiry = (meta.engineer || isBandBooking) ? calculatePriorityExpiry(startDateTime) : null;
        const rescheduleDeadline = calculateRescheduleDeadline(startDateTime);

        // Branch on multi-day vs single-day. The multi-day path inserts 3
        // rows + tracks the day-1 row as the canonical "newBooking" so the
        // downstream notification + XP code paths continue to work.
        let newBooking: { id: string } | null = null;

        if (is3DayBlock) {
          // 3-day band block: insert 3 rows linked by a shared group UUID.
          // Day 1 has setup_minutes_before from metadata. Days 2-3 are 0.
          // The Sweet Spot day (if any) gets duration extended by 2 hours
          // AND the sweet_spot_addon JSONB.
          const groupId = randomUUID();
          // Stripe deposit covers all 3 days. We split the total/deposit/
          // remainder evenly across the 3 rows so the per-row accounting
          // keeps making sense to engineers and admins reading individual
          // sessions. Round to integer cents; the deposit lands on day 1.
          const totalCents = parseInt(meta.total_amount);
          const depositCents = parseInt(meta.deposit_amount);
          const remainderCents = parseInt(meta.remainder_amount);
          const perDayTotal = Math.round(totalCents / 3);
          const perDayRemainder = Math.round(remainderCents / 3);
          // Day 1 absorbs the rounding leftover so the sum of remainders
          // always equals remainderCents exactly. Math.round can leave a
          // 1-cent gap in either direction; deriving Day 1 from the others
          // (vs. from totals) keeps the math consistent and never negative.
          const day1Remainder = Math.max(0, remainderCents - 2 * perDayRemainder);
          const day1SetupMinutes = parseInt(meta.setup_minutes_before || '60', 10) || 60;

          // Day 1 / Day 2 / Day 3 anchor dates. We compute by adding 24h to
          // a Date built from the meta.session_date — UTC parsing keeps the
          // local Fort Wayne time intact (the rest of the system uses the
          // same convention).
          const baseDate = new Date(`${meta.session_date}T${padClockHm(meta.start_time)}:00Z`);

          const insertedIds: string[] = [];
          // Narrow the addon to its 3day-addon shape once, outside the
          // loop, so TypeScript can prove `sweetSpotAddon.extra_filming_hours`
          // is defined inside the truthy branch.
          const filmingAddon =
            sweetSpotAddon?.kind === '3day-addon' ? sweetSpotAddon : null;
          for (let i = 0; i < 3; i++) {
            const dayStart = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
            const isFilmingDay = !!filmingAddon && filmingAddon.filmingDayIndex === i;
            const dayDuration = isFilmingDay ? 8 + filmingAddon.extra_filming_hours : 8;
            const dayEnd = new Date(dayStart.getTime() + dayDuration * 60 * 60 * 1000);
            const dayPriority = meta.engineer ? calculatePriorityExpiry(dayStart.toISOString()) : null;
            const dayReschedule = calculateRescheduleDeadline(dayStart.toISOString());

            const { data: row, error } = await supabase.from('bookings').insert({
              customer_name: meta.customer_name,
              customer_email: meta.customer_email,
              customer_phone: meta.customer_phone || null,
              start_time: dayStart.toISOString(),
              end_time: dayEnd.toISOString(),
              duration: dayDuration,
              room: meta.room,
              engineer_name: null,
              requested_engineer: meta.engineer || null,
              total_amount: perDayTotal,
              deposit_amount: i === 0 ? depositCents : 0,
              remainder_amount: i === 0 ? day1Remainder : perDayRemainder,
              actual_deposit_paid: i === 0 ? session.amount_total : 0,
              night_fees_amount: 0,
              same_day_fee: false,
              same_day_fee_amount: 0,
              guest_count: 1,
              guest_fee_amount: 0,
              stripe_customer_id: session.customer as string,
              stripe_checkout_session_id: session.id,
              // Only day 1 carries the payment_intent — the deposit hit there.
              stripe_payment_intent_id: i === 0 ? (session.payment_intent as string) : null,
              // Deposit paid, no engineer yet → 'pending' (Awaiting Engineer).
              // Flips to 'confirmed' only when an engineer claims (respond/claim).
              status: 'pending',
              priority_expires_at: dayPriority,
              reschedule_deadline: dayReschedule,
              admin_notes:
                i === 0
                  ? `${meta.notes || ''}\n\n3-day block — Day ${i + 1} of 3. Admin must call buyer to confirm logistics.`.trim()
                  : `3-day block — Day ${i + 1} of 3.`,
              band_id: meta.band_id || null,
              setup_minutes_before: i === 0 ? day1SetupMinutes : 0,
              booking_group_id: groupId,
              sweet_spot_addon: isFilmingDay ? sweetSpotAddon : null,
            }).select('id').single();

            if (error) {
              // 3-day inserts must all succeed atomically. If any day fails,
              // roll back what we wrote + clear the dedup claim so Stripe
              // retries the whole event. Without this, a partial insert would
              // be permanent (claim-at-start blocks future retries).
              console.error(`[webhook] 3-day band row insert (day ${i + 1}) failed — rolling back:`, error);
              if (insertedIds.length > 0) {
                await supabase.from('bookings').delete().in('id', insertedIds);
              }
              await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
              return NextResponse.json(
                { error: `Day ${i + 1} insert failed: ${error.message}` },
                { status: 500 },
              );
            }
            if (row) {
              insertedIds.push(row.id);
              if (i === 0) newBooking = row;
            }
          }

          console.log(
            `[webhook] 3-day band block inserted: groupId=${groupId} rowCount=${insertedIds.length} band=${meta.band_id || 'none'}`,
          );
        } else {
          // Single-day path. Add Sweet Spot extension if 8hr add-on present.
          const filmingExtraHours =
            sweetSpotAddon?.kind === '8hr-addon' ? sweetSpotAddon.extra_filming_hours : 0;
          const finalDuration = baseDurationHours + filmingExtraHours;
          const finalEndTime =
            filmingExtraHours > 0
              ? new Date(
                  new Date(startDateTime).getTime() + finalDuration * 60 * 60 * 1000,
                ).toISOString()
              : endDateTime;

          const { data: row, error: insertErr } = await supabase.from('bookings').insert({
            customer_name: meta.customer_name,
            customer_email: meta.customer_email,
            customer_phone: meta.customer_phone || null,
            start_time: startDateTime,
            end_time: finalEndTime,
            duration: finalDuration,
            room: meta.room,
            engineer_name: null,
            requested_engineer: meta.engineer || null,
            total_amount: parseInt(meta.total_amount),
            deposit_amount: parseInt(meta.deposit_amount),
            remainder_amount: parseInt(meta.remainder_amount),
            actual_deposit_paid: session.amount_total,
            // Rewards banking: full session value (staff paid on this even when a
            // discount lowered total_amount) + the discount grant that funded it.
            // Fallback to total_amount keeps non-reward bookings identical.
            service_value_cents: parseInt(meta.service_value_cents || meta.total_amount),
            reward_grant_id: meta.applied_discount_grant_id || null,
            night_fees_amount: parseInt(meta.night_fees || '0'),
            same_day_fee: meta.same_day === 'true',
            same_day_fee_amount: parseInt(meta.same_day_fee || '0'),
            guest_count: parseInt(meta.guest_count || '1'),
            guest_fee_amount: parseInt(meta.guest_fee || '0'),
            stripe_customer_id: session.customer as string,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent as string,
            // Deposit paid, no engineer yet → 'pending' (Awaiting Engineer);
            // an engineer claiming (respond/claim) flips it to 'confirmed'.
            status: 'pending',
            priority_expires_at: priorityExpiry,
            reschedule_deadline: rescheduleDeadline,
            admin_notes: meta.notes || null,
            band_id: meta.band_id || null,
            setup_minutes_before: parseInt(meta.setup_minutes_before || '0', 10) || 0,
            sweet_spot_addon: sweetSpotAddon,
          }).select('id').single();
          if (insertErr || !row) {
            // Customer paid; without a booking row we'd have a ghost charge.
            // Roll back the dedup claim so Stripe retries — better to receive
            // a duplicate event later than to silently lose the booking.
            console.error('[webhook] solo/band-single insert failed — rolling back claim:', insertErr);
            await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
            return NextResponse.json(
              { error: insertErr?.message || 'Booking insert failed' },
              { status: 500 },
            );
          }
          newBooking = row;
          // Single-use: mark the discount grant redeemed now it's a paid booking.
          if (meta.applied_discount_grant_id && row?.id) {
            try { await markGrantRedeemed(supabase, meta.applied_discount_grant_id, row.id); }
            catch (e) { console.error('[webhook] mark grant redeemed failed (non-fatal):', e); }
          }
          // Free studio hour: drain 1 hour now this is a confirmed paid booking
          // (payment-gated + idempotent). Solo /book only — band sessions never
          // set free_hour_applied. No-op when the metadata is absent, so the
          // normal booking path is unaffected.
          if (meta.free_hour_applied === '1' && meta.free_hour_credit_id && row?.id) {
            await drainFreeHourForBooking(supabase, {
              bookingId: row.id,
              creditId: meta.free_hour_credit_id,
              redeemedBy: meta.redeemed_by || null,
              eventId: event.id,
              eventType: event.type,
              paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
              amount: session.amount_total,
              meta,
            });
          }
        }

        // Send emails — bookings.start_time is wall-clock-as-UTC → fmtSession*
        const dateStr = fmtSessionDate(startDateTime, { weekday: 'long', month: 'long', day: 'numeric' });
        const timeStr = fmtSessionTime(startDateTime);
        const duration = parseFloat(meta.duration_hours);

        // Customer confirmation
        await sendBookingConfirmation(meta.customer_email, {
          customerName: meta.customer_name,
          date: dateStr,
          startTime: timeStr,
          duration,
          room: meta.room,
          total: parseInt(meta.total_amount),
          deposit: session.amount_total || parseInt(meta.deposit_amount),
          bookingId: newBooking?.id,
        });

        // Admin alert
        await sendAdminBookingAlert({
          id: newBooking?.id || '',
          customerName: meta.customer_name,
          customerEmail: meta.customer_email,
          date: dateStr,
          startTime: timeStr,
          duration,
          room: meta.room,
          total: parseInt(meta.total_amount),
        });

        // Notify engineers. Two routing rules:
        //   • Band sessions ALWAYS go to Iszac (the dedicated band engineer)
        //     with priority — never fan out to other Studio A engineers. If
        //     Iszac can't take it, he reschedules with the band directly via
        //     the chat thread (Round 8b) — no fallback claim path.
        //   • Solo sessions: requested engineer gets priority; if no
        //     preference, fan out to every engineer assigned to that studio.
        const room = meta.room as string;
        if (isBandBooking) {
          // Band sessions route to band-eligible engineers (can_book_bands):
          //   • a specific requested band engineer → priority alert to them;
          //   • 'any'/no preference → fan out to all band-eligible engineers so
          //     any of them can claim it.
          const roster = await loadEngineers(supabase, { activeOnly: true });
          const bandEngineers = roster.filter((e) => e.canBookBands);
          const requestedBandEng = meta.engineer && meta.engineer !== 'any'
            ? bandEngineers.find((e) => e.name === meta.engineer || e.displayName === meta.engineer)
            : null;
          if (requestedBandEng && priorityExpiry) {
            const priorityLabel = getPriorityHoursLabel(priorityExpiry);
            await sendEngineerPriorityAlert(requestedBandEng.email, {
              id: newBooking?.id || '',
              customerName: meta.customer_name,
              date: dateStr,
              startTime: timeStr,
              duration,
              room: meta.room,
              priorityHours: priorityLabel,
            });
          } else {
            const bandEmails = bandEngineers.map((e) => e.email).filter(Boolean);
            if (bandEmails.length > 0) {
              await sendEngineerNewBookingAlert(bandEmails, {
                id: newBooking?.id || '',
                customerName: meta.customer_name,
                date: dateStr,
                startTime: timeStr,
                duration,
                room: meta.room,
              });
            }
          }
        } else if (meta.engineer && priorityExpiry) {
          // Solo: requested engineer gets priority — only notify them
          const requestedEng = ENGINEERS.find(
            (e) => e.name === meta.engineer || e.displayName === meta.engineer
          );
          if (requestedEng) {
            const priorityLabel = getPriorityHoursLabel(priorityExpiry);
            await sendEngineerPriorityAlert(requestedEng.email, {
              id: newBooking?.id || '',
              customerName: meta.customer_name,
              date: dateStr,
              startTime: timeStr,
              duration,
              room: meta.room,
              priorityHours: priorityLabel,
            });
          }
        } else {
          // Solo, no preference — notify all engineers for this studio
          const engineerEmails = ENGINEERS
            .filter((e) => e.studios.includes(room as Room))
            .map((e) => e.email);
          if (engineerEmails.length > 0) {
            await sendEngineerNewBookingAlert(engineerEmails, {
              id: newBooking?.id || '',
              customerName: meta.customer_name,
              date: dateStr,
              startTime: timeStr,
              duration,
              room: meta.room,
            });
          }
        }

        // Award XP for booking — look up user by email. xp_log FKs auth.users,
        // so pass user_id, NOT profiles.id (the old arg violated the FK and
        // this hook had never landed a row — career-path fix).
        try {
          const { data: bookerProfile } = await supabase
            .from('profiles')
            .select('user_id')
            .eq('email', meta.customer_email)
            .limit(1)
            .single();
          if (bookerProfile?.user_id && newBooking?.id) {
            await awardXP(supabase, bookerProfile.user_id, 'book_session', {
              referenceId: newBooking.id,
              metadata: { room: meta.room, date: meta.session_date },
            });
          }
        } catch { /* user may not have an account — skip XP */ }
      } else if (meta.type === 'invite_deposit') {
        // Invite booking — deposit paid, confirm the existing pending booking
        const bookingId = meta.booking_id;

        const { data: existingBooking } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (existingBooking) {
          await supabase.from('bookings').update({
            // Confirmed only if the invite already names an engineer; else 'pending'.
            status: paidBookingStatus(existingBooking.engineer_name),
            actual_deposit_paid: session.amount_total,
            stripe_customer_id: session.customer as string,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent as string,
            updated_at: new Date().toISOString(),
          }).eq('id', bookingId);

          // Create media_sales records if booking has media add-ons (with dedup check)
          const mediaAddons = existingBooking.media_addons;
          if (mediaAddons && Array.isArray(mediaAddons) && mediaAddons.length > 0) {
            const { data: existingMediaSales } = await supabase
              .from('media_sales')
              .select('id')
              .eq('booking_id', bookingId)
              .limit(1);

            if (!existingMediaSales?.length) {
              for (const addon of mediaAddons) {
                await supabase.from('media_sales').insert({
                  description: addon.description || addon.type,
                  amount: addon.amount,
                  sale_type: addon.type,
                  sold_by: addon.sold_by || null,
                  filmed_by: addon.filmed_by || null,
                  edited_by: addon.edited_by || null,
                  client_name: existingBooking.customer_name,
                  client_email: existingBooking.customer_email,
                  booking_id: bookingId,
                  notes: `From session invite`,
                });
              }
            }
          }

          // Send confirmation emails — bookings.start_time is wall-clock-as-UTC → fmtSession*
          const dateStr = fmtSessionDate(existingBooking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
          const timeStr = fmtSessionTime(existingBooking.start_time);

          if (existingBooking.customer_email) {
            await sendBookingConfirmation(existingBooking.customer_email, {
              customerName: existingBooking.customer_name,
              date: dateStr,
              startTime: timeStr,
              duration: existingBooking.duration,
              room: existingBooking.room || '',
              total: existingBooking.total_amount,
              deposit: session.amount_total || existingBooking.deposit_amount,
              bookingId,
            });
          }

          await sendAdminBookingAlert({
            id: bookingId,
            customerName: existingBooking.customer_name,
            customerEmail: existingBooking.customer_email || '',
            date: dateStr,
            startTime: timeStr,
            duration: existingBooking.duration,
            room: existingBooking.room || '',
            total: existingBooking.total_amount,
          });

          // Set dynamic priority window and reschedule deadline
          const invitePriorityExpiry = existingBooking.requested_engineer
            ? calculatePriorityExpiry(existingBooking.start_time)
            : null;
          const inviteRescheduleDeadline = calculateRescheduleDeadline(existingBooking.start_time);

          await supabase.from('bookings').update({
            priority_expires_at: invitePriorityExpiry,
            reschedule_deadline: inviteRescheduleDeadline,
          }).eq('id', bookingId);

          // Notify engineers — BUT NOT if the booking already has an engineer assigned (invite sessions)
          // Invite bookings auto-assign the engineer who created the invite, so no claim needed
          if (!existingBooking.engineer_name) {
            const room = existingBooking.room as string;
            if (existingBooking.requested_engineer && invitePriorityExpiry) {
              const requestedEng = ENGINEERS.find(
                (e) => e.name === existingBooking.requested_engineer || e.displayName === existingBooking.requested_engineer
              );
              if (requestedEng) {
                const priorityLabel = getPriorityHoursLabel(invitePriorityExpiry);
                await sendEngineerPriorityAlert(requestedEng.email, {
                  id: bookingId,
                  customerName: existingBooking.customer_name,
                  date: dateStr,
                  startTime: timeStr,
                  duration: existingBooking.duration,
                  room: existingBooking.room || '',
                  priorityHours: priorityLabel,
                });
              }
            } else {
              const engineerEmails = ENGINEERS
                .filter((e) => e.studios.includes(room as Room))
                .map((e) => e.email);
              if (engineerEmails.length > 0) {
                await sendEngineerNewBookingAlert(engineerEmails, {
                  id: bookingId,
                  customerName: existingBooking.customer_name,
                  date: dateStr,
                  startTime: timeStr,
                  duration: existingBooking.duration,
                  room: existingBooking.room || '',
                });
            }
          }
          } // end if (!existingBooking.engineer_name)
        }
      } else if (meta.type === 'booking_remainder') {
        // Remainder paid via Checkout (fallback when off-session charge failed,
        // OR an engineer sent a custom payment link via "Send Payment Link").
        //
        // Engineers commonly use this flow to charge for time/services added
        // DURING the session ("you ran 30 extra minutes, $25 more"). In that
        // case the engineer-entered amount exceeds the stored remainder, and
        // total_amount has to grow to match what was actually collected.
        //
        // The direct off-session path in /api/booking/charge-remainder already
        // does `total = total - remainder + amount` when amount > remainder.
        // This branch must mirror that logic — otherwise the booking's total
        // under-reports revenue (see Jordan Hudson May 19 case).
        const bookingId = meta.booking_id;
        const chargeAmount = parseInt(meta.charge_amount || '0') || (session.amount_total || 0);

        const { data: remainderBooking } = await supabase
          .from('bookings')
          .select('remainder_amount, total_amount')
          .eq('id', bookingId)
          .single();

        if (remainderBooking) {
          const currentRemainder = remainderBooking.remainder_amount || 0;
          const currentTotal = remainderBooking.total_amount || 0;
          const overage = Math.max(0, chargeAmount - currentRemainder);
          const updates: Record<string, unknown> = {
            remainder_amount: Math.max(0, currentRemainder - chargeAmount),
            updated_at: new Date().toISOString(),
          };
          if (overage > 0) {
            updates.total_amount = currentTotal + overage;
          }
          await supabase.from('bookings').update(updates).eq('id', bookingId);
        }
      } else if (meta.type === 'beat_purchase') {
        // Beat store purchase
        const buyerEmail = session.customer_details?.email || meta.buyer_email;
        const buyerName = meta.buyer_name || buyerEmail?.split('@')[0] || 'Buyer';

        // Generate license text
        let licenseText = '';
        try {
          const { generateLicenseText } = await import('@/lib/license-templates');
          licenseText = generateLicenseText({
            buyerName,
            buyerEmail,
            beatTitle: meta.beat_title || 'Unknown',
            producerName: meta.producer || 'Unknown',
            licenseType: meta.license_type as 'mp3_lease' | 'trackout_lease' | 'exclusive',
            amountPaid: session.amount_total || 0,
            purchaseDate: new Date().toLocaleDateString('en-US'),
            purchaseId: session.id,
          });
        } catch { /* license gen failure shouldn't block purchase */ }

        // Calculate lease expiration date
        const { LEASE_DURATION_DAYS } = await import('@/lib/constants');
        const durationDays = LEASE_DURATION_DAYS[meta.license_type as string] ?? null;
        let leaseExpiresAt: string | null = null;
        if (durationDays) {
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + durationDays);
          leaseExpiresAt = expiry.toISOString();
        }
        // Check if this is a lifetime lease beat (explicit flag — never expires)
        // Producer can also offer "Lease Only" mode (MP3-only, no exclusive, but still 1yr expiring).
        if (meta.license_type !== 'exclusive') {
          const { data: beatInfo } = await supabase.from('beats').select('is_lifetime_lease').eq('id', meta.beat_id).single();
          if (beatInfo && beatInfo.is_lifetime_lease) {
            leaseExpiresAt = null; // Lifetime lease — never expires
          }
        }

        const { data: purchase } = await supabase.from('beat_purchases').insert({
          beat_id: meta.beat_id,
          buyer_id: meta.buyer_id || null,
          buyer_email: buyerEmail,
          license_type: meta.license_type,
          amount_paid: session.amount_total,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent as string,
          payment_method: 'stripe',
          license_text: licenseText || null,
          lease_expires_at: leaseExpiresAt,
        }).select('id').single();

        // Redeem the beat-reward discount that funded this purchase. The exclusive
        // perk is MULTI-use (up to BEAT_EXCLUSIVE_DISCOUNT_MAX_USES exclusives); lease
        // discounts are single-use.
        if (meta.applied_beat_discount_grant_id && purchase?.id) {
          try {
            if (meta.license_type === 'exclusive') {
              await redeemBeatDiscountUse(supabase, meta.applied_beat_discount_grant_id, purchase.id, BEAT_EXCLUSIVE_DISCOUNT_MAX_USES);
            } else {
              await markGrantRedeemed(supabase, meta.applied_beat_discount_grant_id, purchase.id);
            }
          } catch (e) { console.error('[webhook] beat discount grant redeem failed (non-fatal):', e); }
        }

        // If exclusive and purchase was created, mark beat as sold + grandfather existing leases
        if (purchase && meta.license_type === 'exclusive') {
          await supabase.from('beats').update({
            status: 'sold_exclusive',
            exclusive_buyer_id: meta.buyer_id || null,
            exclusive_sold_at: new Date().toISOString(),
          }).eq('id', meta.beat_id);

          // Grandfather existing leases — block renewal but let them run until expiry
          try {
            const { data: existingLeases } = await supabase
              .from('beat_purchases')
              .select('id, buyer_email, license_type, created_at, lease_expires_at')
              .eq('beat_id', meta.beat_id)
              .in('license_type', ['mp3_lease', 'trackout_lease'])
              .is('revoked_at', null)
              .neq('id', purchase.id);

            if (existingLeases && existingLeases.length > 0) {
              // Block renewal but do NOT revoke — leases stay active until expiry
              const leaseIds = existingLeases.map(l => l.id);
              await supabase.from('beat_purchases').update({
                renewal_blocked: true,
                revoked_reason: 'Exclusive purchased — lease grandfathered until expiry',
              }).in('id', leaseIds);

              // Notify each leaseholder that their lease is grandfathered
              const { sendLeaseRevokedNotification } = await import('@/lib/email');
              for (const lease of existingLeases) {
                if (lease.buyer_email) {
                  try {
                    const leaseName = lease.buyer_email.split('@')[0] || 'Customer';
                    // lease_expires_at + created_at are true-UTC *_at instants → fmtStamp*
                    const expiryDate = lease.lease_expires_at
                      ? fmtStampDate(lease.lease_expires_at, { month: 'long', day: 'numeric', year: 'numeric' })
                      : 'your license term';
                    await sendLeaseRevokedNotification(lease.buyer_email, {
                      buyerName: leaseName,
                      beatTitle: meta.beat_title || 'Beat',
                      producerName: meta.producer || 'Unknown',
                      licenseType: lease.license_type === 'mp3_lease' ? 'MP3 Lease' : 'Trackout Lease',
                      purchaseDate: fmtStampDate(lease.created_at),
                    });
                  } catch (emailErr) { console.error(`Failed to send grandfathered email to ${lease.buyer_email}:`, emailErr); }
                }
              }
              console.log(`Grandfathered ${existingLeases.length} lease(s) for beat ${meta.beat_id} — exclusive purchased`);
            }
          } catch (e) { console.error('Lease grandfathering error:', e); }
        }

        // Send purchase confirmation email to buyer
        try {
          const { sendBeatPurchaseConfirmation } = await import('@/lib/email');
          await sendBeatPurchaseConfirmation(buyerEmail, {
            buyerName,
            beatTitle: meta.beat_title || 'Beat',
            producerName: meta.producer || 'Unknown',
            licenseType: meta.license_type,
            amount: session.amount_total || 0,
            purchaseId: purchase?.id || session.id,
          });
        } catch (e) { console.error('Beat purchase email error:', e); }

        // Notify producer of sale
        try {
          if (meta.producer_id) {
            const { data: producerProfile } = await supabase
              .from('profiles')
              .select('user_id')
              .eq('id', meta.producer_id)
              .single();
            if (producerProfile?.user_id) {
              const { data: { user: producerAuth } } = await supabase.auth.admin.getUserById(producerProfile.user_id);
              if (producerAuth?.email) {
                const { sendBeatSaleProducerNotification } = await import('@/lib/email');
                await sendBeatSaleProducerNotification(producerAuth.email, {
                  buyerName,
                  buyerEmail,
                  beatTitle: meta.beat_title || 'Beat',
                  licenseType: meta.license_type,
                  amount: session.amount_total || 0,
                  producerEarnings: Math.round((session.amount_total || 0) * 0.6),
                });
              }
            }
          }
        } catch (e) { console.error('Producer notification error:', e); }

        // Award XP for beat purchase
        if (meta.buyer_id) {
          try {
            await awardXP(supabase, meta.buyer_id, 'purchase_beat', {
              referenceId: `${meta.beat_id}_${meta.license_type}`,
              metadata: { beat_id: meta.beat_id, license_type: meta.license_type, beat_title: meta.beat_title },
            });
          } catch { /* buyer may not have a profile — skip XP */ }
        }
      } else if (meta.type === 'beat_renewal') {
        // Lease renewal — create new purchase record linked to original
        const { LEASE_DURATION_DAYS } = await import('@/lib/constants');
        const durationDays = LEASE_DURATION_DAYS[meta.license_type as string] ?? 365;
        const newExpiry = new Date();
        if (durationDays) newExpiry.setDate(newExpiry.getDate() + durationDays);

        await supabase.from('beat_purchases').insert({
          beat_id: meta.beat_id,
          buyer_id: meta.buyer_id || null,
          buyer_email: meta.buyer_email,
          license_type: meta.license_type,
          amount_paid: session.amount_total,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent as string,
          payment_method: 'stripe',
          renewed_from_id: meta.original_purchase_id,
          lease_expires_at: durationDays ? newExpiry.toISOString() : null,
        });

      } else if (meta.type === 'beat_upgrade') {
        // License upgrade — create new purchase with upgraded license type
        const { LEASE_DURATION_DAYS } = await import('@/lib/constants');
        const durationDays = LEASE_DURATION_DAYS[meta.license_type as string] ?? null;
        let newExpiry: string | null = null;
        if (durationDays) {
          const exp = new Date();
          exp.setDate(exp.getDate() + durationDays);
          newExpiry = exp.toISOString();
        }

        // Generate license text for the new license type
        let licenseText = '';
        try {
          const { generateLicenseText } = await import('@/lib/license-templates');
          licenseText = generateLicenseText({
            buyerName: meta.buyer_email?.split('@')[0] || 'Buyer',
            buyerEmail: meta.buyer_email,
            beatTitle: meta.beat_title || 'Beat',
            producerName: meta.producer || 'Unknown',
            licenseType: meta.license_type as 'mp3_lease' | 'trackout_lease' | 'exclusive',
            amountPaid: session.amount_total || 0,
            purchaseDate: new Date().toLocaleDateString('en-US'),
            purchaseId: session.id,
          });
        } catch { /* */ }

        const { data: upgradePurchase } = await supabase.from('beat_purchases').insert({
          beat_id: meta.beat_id,
          buyer_id: meta.buyer_id || null,
          buyer_email: meta.buyer_email,
          license_type: meta.license_type,
          amount_paid: session.amount_total,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent as string,
          payment_method: 'stripe',
          upgraded_from_id: meta.original_purchase_id,
          lease_expires_at: newExpiry,
          license_text: licenseText || null,
        }).select('id').single();

        // If upgraded to exclusive, run the grandfathering logic
        if (upgradePurchase && meta.license_type === 'exclusive') {
          await supabase.from('beats').update({
            status: 'sold_exclusive',
            exclusive_buyer_id: meta.buyer_id || null,
            exclusive_sold_at: new Date().toISOString(),
          }).eq('id', meta.beat_id);

          // Grandfather other leases
          const { data: otherLeases } = await supabase
            .from('beat_purchases')
            .select('id')
            .eq('beat_id', meta.beat_id)
            .in('license_type', ['mp3_lease', 'trackout_lease'])
            .is('revoked_at', null)
            .neq('id', meta.original_purchase_id);

          if (otherLeases && otherLeases.length > 0) {
            await supabase.from('beat_purchases').update({
              renewal_blocked: true,
              revoked_reason: 'Exclusive purchased — lease grandfathered until expiry',
            }).in('id', otherLeases.map(l => l.id));
          }
        }

      } else if (meta.type === 'private_beat_sale') {
        // Private beat sale — buyer paid via Stripe after signing agreement
        const privateSaleId = meta.private_sale_id;
        const { data: sale } = await supabase
          .from('private_beat_sales')
          .select('*')
          .eq('id', privateSaleId)
          .single();

        if (sale && sale.status !== 'completed') {
          // Create beat_purchases record
          const { data: purchase } = await supabase
            .from('beat_purchases')
            .insert({
              beat_id: sale.beat_id || null,
              buyer_id: null,
              buyer_email: session.customer_details?.email || sale.buyer_email,
              license_type: sale.license_type,
              amount_paid: session.amount_total,
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: session.payment_intent as string,
              payment_method: 'stripe',
              private_sale_id: sale.id,
            })
            .select('id')
            .single();

          // Update private sale to completed
          await supabase.from('private_beat_sales').update({
            status: 'completed',
            paid_at: new Date().toISOString(),
            purchase_id: purchase?.id || null,
          }).eq('id', privateSaleId);

          // If exclusive and has a beat_id and purchase was created, mark beat as sold + grandfather leases
          if (purchase && sale.license_type === 'exclusive' && sale.beat_id) {
            await supabase.from('beats').update({
              status: 'sold_exclusive',
              exclusive_sold_at: new Date().toISOString(),
            }).eq('id', sale.beat_id);

            // Grandfather existing leases — block renewal but keep active until expiry
            try {
              const { data: existingLeases } = await supabase
                .from('beat_purchases')
                .select('id, buyer_email, license_type, created_at, lease_expires_at')
                .eq('beat_id', sale.beat_id)
                .in('license_type', ['mp3_lease', 'trackout_lease'])
                .is('revoked_at', null);

              if (existingLeases && existingLeases.length > 0) {
                const leaseIds = existingLeases.map(l => l.id);
                await supabase.from('beat_purchases').update({
                  renewal_blocked: true,
                  revoked_reason: 'Exclusive purchased — lease grandfathered until expiry',
                }).in('id', leaseIds);

                const { sendLeaseRevokedNotification } = await import('@/lib/email');
                const { data: beatInfo } = await supabase.from('beats').select('title, producer').eq('id', sale.beat_id).single();
                for (const lease of existingLeases) {
                  if (lease.buyer_email) {
                    try {
                      await sendLeaseRevokedNotification(lease.buyer_email, {
                        buyerName: lease.buyer_email.split('@')[0] || 'Customer',
                        beatTitle: beatInfo?.title || sale.beat_title || 'Beat',
                        producerName: beatInfo?.producer || sale.beat_producer || 'Unknown',
                        licenseType: lease.license_type === 'mp3_lease' ? 'MP3 Lease' : 'Trackout Lease',
                        // created_at is a true-UTC *_at instant → convert to Eastern (fmtStamp*)
                        purchaseDate: fmtStampDate(lease.created_at),
                      });
                    } catch (emailErr) { console.error(`Failed to send grandfathered email to ${lease.buyer_email}:`, emailErr); }
                  }
                }
                console.log(`Grandfathered ${existingLeases.length} lease(s) for beat ${sale.beat_id} — exclusive purchased (private sale)`);
              }
            } catch (e) { console.error('Private sale lease grandfathering error:', e); }
          }

          // Send completion emails
          try {
            const { sendPrivateBeatSaleComplete, sendPrivateBeatSaleNotification } = await import('@/lib/email');
            await sendPrivateBeatSaleComplete(sale.buyer_email, {
              buyerName: sale.buyer_name || 'there',
              beatTitle: sale.beat_title,
              producerName: sale.beat_producer,
              licenseType: sale.license_type,
              amount: sale.amount,
              token: sale.token,
            });

            // Notify producer/creator
            if (sale.created_by) {
              const { data: creator } = await supabase
                .from('profiles')
                .select('user_id')
                .eq('id', sale.created_by)
                .single();
              if (creator?.user_id) {
                const { data: { user: creatorAuth } } = await supabase.auth.admin.getUserById(creator.user_id);
                if (creatorAuth?.email) {
                  await sendPrivateBeatSaleNotification(creatorAuth.email, {
                    buyerName: sale.buyer_name || 'Unknown',
                    buyerEmail: sale.buyer_email,
                    beatTitle: sale.beat_title,
                    licenseType: sale.license_type,
                    amount: sale.amount,
                    paymentMethod: 'stripe',
                  });
                }
              }
            }
          } catch (e) {
            console.error('Private sale email error:', e);
          }
        }
      } else if (meta.type === 'media_purchase') {
        // ── Media Hub purchase ──────────────────────────────────────
        // Round 5: the checkout API can now stash a CART of multiple
        // offerings into the metadata under cart_part_0..N (chunked at
        // 480 chars to stay inside Stripe's 500-char per-field limit).
        // We reassemble + parse it here. When `cart_count > 0` we fan
        // out into N media_bookings rows; the legacy single-item path
        // (no cart parts) still works unchanged for direct API calls.
        const offeringTitle = meta.offering_title || meta.offering_slug;
        const buyerId = meta.buyer_id;
        const buyerName = meta.buyer_name || meta.buyer_email?.split('@')[0] || 'Buyer';
        const buyerEmail = session.customer_details?.email || meta.buyer_email;
        const bandId = meta.band_id || null;
        const amountPaid = session.amount_total || 0;
        const cartCount = parseInt(meta.cart_count || '0', 10);
        const cartParts = parseInt(meta.cart_parts || '0', 10);

        // Reassemble the cart JSON from chunks. If the buyer hit the
        // legacy single-item path, fall back to a synthetic cart with
        // ONE entry built from the flat metadata fields.
        let cart: Array<{
          offering_id: string;
          offering_slug: string;
          offering_title: string;
          offering_kind: string;
          studio_hours_included: number;
          price_cents: number;
          configured_components: unknown;
          project_details: unknown;
          summary: string;
        }> = [];

        if (cartCount > 0 && cartParts > 0) {
          let cartJson = '';
          for (let i = 0; i < cartParts; i++) {
            const chunk = meta[`cart_part_${i}`];
            if (typeof chunk === 'string') cartJson += chunk;
          }
          try {
            const parsed = JSON.parse(cartJson);
            if (Array.isArray(parsed)) cart = parsed;
          } catch {
            console.error('[webhook] media_purchase cart parse failed — falling back to single-item');
          }
        }

        if (cart.length === 0) {
          // Legacy single-item shape — build one cart entry from flat fields.
          let configuredComponents: unknown = null;
          if (meta.configured_components) {
            try {
              configuredComponents = JSON.parse(meta.configured_components);
            } catch {
              configuredComponents = { raw: meta.configured_components };
            }
          }
          let projectDetails: unknown = null;
          if (meta.project_details) {
            try {
              const parsed = JSON.parse(meta.project_details);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                projectDetails = parsed;
              }
            } catch {
              projectDetails = { raw: meta.project_details };
            }
          }
          cart = [{
            offering_id: meta.offering_id || '',
            offering_slug: meta.offering_slug || '',
            offering_title: offeringTitle || '',
            offering_kind: meta.offering_kind || 'standalone',
            studio_hours_included: parseInt(meta.studio_hours_included || '0', 10),
            price_cents: amountPaid,
            configured_components: configuredComponents,
            project_details: projectDetails,
            summary: meta.configuration_summary || '',
          }];
        }

        // Track all created booking IDs + the total studio hours for
        // accounting (one studio_credits row per cart). The first row
        // is the "primary" booking — we use its id for XP + emails.
        const createdBookingIds: string[] = [];
        let primaryBookingId: string | null = null;
        let totalStudioHours = 0;

        // Round 6: Stripe now charges 50% deposit. Per-line full price
        // sits in the cart snapshot; per-line deposit is half (rounded
        // down to integer cents for Stripe). final_paid_at stays null
        // until admin marks the remainder paid via the future
        // /api/admin/media/bookings/[id] PATCH (same path that already
        // handles status flips + deliverables).
        const customerPhone = meta.customer_phone || null;

        for (let idx = 0; idx < cart.length; idx++) {
          const item = cart[idx];
          const fullPrice = Number(item.price_cents) || 0;
          const lineDeposit = Math.floor(fullPrice * 0.5);
          const { data: row, error: bookingErr } = await supabase
            .from('media_bookings')
            .insert({
              offering_id: item.offering_id,
              user_id: buyerId,
              band_id: bandId,
              status: 'deposited',
              configured_components: item.configured_components,
              project_details: item.project_details,
              // Full sticker price stored as final_price_cents; what was
              // actually charged today is deposit_cents. Remainder lives
              // in the gap (final - deposit) and gets billed later.
              final_price_cents: fullPrice,
              deposit_cents: lineDeposit,
              customer_phone: customerPhone,
              // Only the first row carries the Stripe payment intent / session
              // since they all share the same checkout session. Putting them
              // on every row would make the data redundant.
              stripe_payment_intent_id: idx === 0 ? (session.payment_intent as string) : null,
              stripe_session_id: session.id,
              deposit_paid_at: new Date().toISOString(),
              // final_paid_at stays NULL until admin charges the remainder.
              final_paid_at: null,
            })
            .select('id')
            .single();

          if (bookingErr) {
            console.error(
              `[webhook] media_bookings insert failed (item ${idx + 1}/${cart.length}):`,
              bookingErr,
            );
          } else if (row) {
            const bookingRowId = (row as { id: string }).id;
            createdBookingIds.push(bookingRowId);
            if (!primaryBookingId) primaryBookingId = bookingRowId;

            // Grant per-deliverable media credits for this item (Phase 2 — the
            // "balance on your account" model). The cart snapshot lacks the
            // offering's base components, so fetch them, then map slots →
            // credits honoring the buyer's skip/tier choices. studio_hours are
            // NOT granted here (studio_credits owns hours — avoids double-grant).
            // A failed grant is logged + admin-alerted but never fatal: the
            // booking + payment are valid and a missed credit is backfillable.
            try {
              const { data: off } = await supabase
                .from('media_offerings')
                .select('kind, slug, title, components')
                .eq('id', item.offering_id)
                .maybeSingle();
              if (off) {
                const grants = creditGrantsFromOffering(
                  off as Pick<MediaOffering, 'kind' | 'slug' | 'title' | 'components'>,
                  (item.configured_components as ConfiguredComponents | null) ?? null,
                );
                const creditOwner = bandId
                  ? { band_id: bandId, user_id: null }
                  : { user_id: buyerId, band_id: null };
                for (const g of grants) {
                  const { error: gErr } = await supabase.from('media_credits').insert({
                    ...creditOwner,
                    credit_kind: g.credit_kind,
                    quantity_granted: g.quantity,
                    quantity_redeemed: 0,
                    tier: g.tier ?? null,
                    source_booking_id: bookingRowId,
                    notes: g.label,
                  });
                  if (gErr) {
                    console.error('[webhook] media_credits grant failed:', gErr.message, g);
                    await alertAdminOfWebhookFailure({
                      eventId: event.id,
                      eventType: event.type,
                      reason: `media_credits grant failed for booking ${bookingRowId}: ${gErr.message}`,
                      metadata: meta,
                      paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
                      amount: session.amount_total,
                    });
                  }
                }
              }
            } catch (ge) {
              console.error('[webhook] media_credits grant threw:', ge);
            }
          }

          totalStudioHours += Number(item.studio_hours_included) || 0;
        }

        // 2. If the cart includes studio hours, create ONE credit row
        //    ("gift card") for the total. Source-of-truth booking is
        //    the first row that had a positive hours grant. Owner is
        //    XOR'd per the studio_credits_owner_xor constraint.
        if (totalStudioHours > 0 && primaryBookingId) {
          const creditOwner = bandId
            ? { band_id: bandId, user_id: null }
            : { user_id: buyerId, band_id: null };

          const { error: creditErr } = await supabase.from('studio_credits').insert({
            ...creditOwner,
            source_booking_id: primaryBookingId,
            hours_granted: totalStudioHours,
            hours_used: 0,
            cost_basis_cents: amountPaid,
          });
          if (creditErr) {
            console.error('[webhook] studio_credits insert failed:', creditErr);
          }
        }

        // For the rest of the side-effect block we keep the legacy
        // variable names so the email + XP code below doesn't have to
        // change. `studioHours` is the total grant for the whole cart;
        // `newBooking` points to the primary row.
        const studioHours = totalStudioHours;
        const newBooking = primaryBookingId ? { id: primaryBookingId } : null;
        const offeringSlug = cart[0]?.offering_slug || meta.offering_slug || '';

        // 3. Award XP for the purchase — same hook the beat purchases use,
        //    same event name pattern. Skip silently if the buyer's profile
        //    isn't found (defensive — they should have one since checkout
        //    is gated on auth, but profile-row-creation is async via
        //    triggers, so brand-new users could race).
        if (buyerId && newBooking) {
          try {
            await awardXP(supabase, buyerId, 'book_session', {
              referenceId: newBooking.id,
              metadata: {
                kind: 'media_purchase',
                offering_slug: offeringSlug,
                amount_cents: amountPaid,
              },
            });
          } catch { /* skip XP on failure — never block the sale */ }
        }

        // 4. Confirmation email to the buyer + admin alert. Both are
        //    fire-and-forget (own try/catch inside the email helpers) so
        //    a Resend outage can never block the booking write or fail
        //    the webhook back to Stripe.
        //
        //    Round 6: cart-aware summary. For multi-item carts the
        //    summary lines come from cart_summary metadata (joined on
        //    ' || '); for legacy single-item flow we fall back to the
        //    older configuration_summary on ` · `. Phone shown to admin
        //    so they know how to reach the buyer.
        const configurationLines = meta.cart_summary
          ? meta.cart_summary.split(' || ').filter(Boolean)
          : meta.configuration_summary
            ? meta.configuration_summary.split(' · ').filter(Boolean)
            : [];
        const totalSticker = cart.reduce((sum, item) => sum + (Number(item.price_cents) || 0), 0);
        const totalDeposit = cart.reduce(
          (sum, item) => sum + Math.floor((Number(item.price_cents) || 0) * 0.5),
          0,
        );
        if (buyerEmail) {
          try {
            await sendMediaPurchaseConfirmation(buyerEmail, {
              buyerName,
              offeringTitle,
              amountPaid,
              studioHoursIncluded: studioHours,
              bandAttached: !!bandId,
              configurationLines,
              bookingId: newBooking?.id,
            });
          } catch (e) {
            console.error('[webhook] media confirmation email error:', e);
          }
        }
        try {
          await sendMediaPurchaseAdminAlert({
            buyerName,
            buyerEmail: buyerEmail || 'unknown',
            offeringTitle: cart.length > 1
              ? `${cart.length} media items (${cart.map((c) => c.offering_title).join(', ')})`
              : offeringTitle,
            amountPaid,
            studioHoursIncluded: studioHours,
            bandAttached: !!bandId,
            configurationLines,
            // Round 6: pass remainder + phone so the admin email shows
            // exactly what the team needs to plan the follow-up call.
            customerPhone: customerPhone,
            fullPriceTotal: totalSticker,
            depositPaid: totalDeposit,
            cartItemCount: cart.length,
          });
        } catch (e) {
          console.error('[webhook] media admin alert error:', e);
        }

        console.log(
          `[webhook] media_purchase processed: offering=${offeringSlug} buyer=${buyerName} (${buyerEmail}) band=${bandId || 'none'} hours=${studioHours} amount=${amountPaid}`,
        );
      } else if (meta.type === 'media_remainder' || meta.type === 'media_manual') {
        // ── Media Hub: remainder OR manual-link payment ──────────────────
        // Both types share the same completion semantics:
        //   • Stripe Payment Link finishes → checkout.session.completed
        //     fires → metadata.booking_id points us at the row.
        //   • We add session.amount_total to actual_deposit_paid; if the
        //     remainder hits 0, stamp final_paid_at + remainder_paid_at.
        //   • Audit log captures the completion verb (link_completed_*)
        //     so the admin history shows BOTH the link-sent + the eventual
        //     payment-arrived events.
        //
        // Why one combined branch for both types:
        //   • media_remainder = admin clicked "Charge remainder → Email link"
        //                       OR "Resend link"
        //   • media_manual    = admin created a manual booking with link
        //                       payment method
        //   The buyer's payment completion logic is identical — only the
        //   audit verb differs so admin history reads cleanly.
        //
        // Idempotency: webhook events can fire twice. We check whether
        // actual_deposit_paid already equals/exceeds the new total before
        // applying — a re-fired event won't double-credit the row.
        const bookingId = meta.booking_id;
        const amountPaid = session.amount_total || 0;
        const isResend = meta.resend === 'true';

        if (!bookingId || amountPaid <= 0) {
          console.error('[webhook] media_remainder/manual missing booking_id or amount', meta);
        } else {
          // Read the row so we can decide: full payment vs. partial.
          const { data: rowBefore } = await supabase
            .from('media_bookings')
            .select('final_price_cents, deposit_cents, actual_deposit_paid, final_paid_at, user_id, offering_id, customer_phone')
            .eq('id', bookingId)
            .maybeSingle();

          type MediaRow = {
            final_price_cents: number;
            deposit_cents: number | null;
            actual_deposit_paid: number | null;
            final_paid_at: string | null;
            user_id: string;
            offering_id: string;
            customer_phone: string | null;
          };
          const row = rowBefore as MediaRow | null;

          if (!row) {
            console.error('[webhook] media_remainder/manual: booking not found', bookingId);
          } else {
            const previousPaid = row.actual_deposit_paid ?? 0;
            const newPaid = Math.min(row.final_price_cents, previousPaid + amountPaid);
            const newRemainder = Math.max(0, row.final_price_cents - newPaid);

            const updates: Record<string, unknown> = {
              actual_deposit_paid: newPaid,
            };
            // First time fully paid → stamp the timestamps. Idempotent
            // because we only stamp when final_paid_at is currently null.
            if (newRemainder === 0 && !row.final_paid_at) {
              const nowIso = new Date().toISOString();
              updates.final_paid_at = nowIso;
              updates.remainder_paid_at = nowIso;
              // Manual bookings created at status='inquiry' move to
              // 'deposited' upon receipt of payment so they appear in
              // the admin's working queue.
              if (meta.type === 'media_manual') {
                updates.status = 'deposited';
                updates.deposit_paid_at = nowIso;
                updates.deposit_cents = newPaid;
                updates.stripe_session_id = session.id;
                if (typeof session.payment_intent === 'string') {
                  updates.stripe_payment_intent_id = session.payment_intent;
                }
              }
            }

            await supabase
              .from('media_bookings')
              .update(updates)
              .eq('id', bookingId);

            // Audit verb depends on type + resend flag so admin history
            // shows distinct events for each pathway.
            const action =
              meta.type === 'media_manual'
                ? 'manual_link_completed'
                : isResend
                ? 'remainder_link_resend_completed'
                : 'remainder_link_completed';

            await supabase.from('media_booking_audit_log').insert({
              booking_id: bookingId,
              action,
              performed_by: 'stripe_webhook',
              details: {
                amount_cents: amountPaid,
                previous_paid: previousPaid,
                new_paid: newPaid,
                new_remainder: newRemainder,
                stripe_session_id: session.id,
                resend: isResend,
              },
            });

            console.log(
              `[webhook] ${action} processed: booking=${bookingId} amount=${amountPaid} new_remainder=${newRemainder}`,
            );
          }
        }
      } else if (meta.type === 'media_installment') {
        // ── Media Projects: one installment paid via its Stripe link ──────
        // The per-installment Payment Link finished → checkout.session.completed
        // fires with metadata { booking_id, installment_id, type:'media_installment' }.
        // Mark THAT installment paid (paid_at, paid_method, payment intent).
        // We do NOT recompute the booking's deposit/remainder columns — for a
        // plan project, "paid so far" is derived from SUM(paid installments)
        // by the readers, leaving the legacy deposit/remainder math untouched.
        //
        // Idempotent: skip if the installment is already 'paid'. The top-level
        // event-id dedup already prevents reprocessing of the same delivery;
        // this is the second guard against an installment being double-marked
        // by distinct events (e.g. a resent link that races the first).
        //
        // Gating note: we DO mark paid even if the contract wasn't agreed —
        // the agree-before-pay gate is enforced where payment is INITIATED
        // (send-link + the artist pay UI), not at money-arrival. By the time
        // a webhook fires the buyer has already paid; refusing it here would
        // just orphan a real payment.
        const bookingId = meta.booking_id;
        const installmentId = meta.installment_id;
        const amountPaid = session.amount_total || 0;
        // Payment source: a hosted Payment Link reads as 'link'; if the buyer
        // paid by card through it, the source method is still the link.
        const paidMethod = 'link';

        if (!bookingId || !installmentId) {
          console.error('[webhook] media_installment missing booking_id/installment_id', meta);
        } else {
          const { data: instBefore } = await supabase
            .from('media_payment_installments')
            .select('id, status, amount_cents, label')
            .eq('id', installmentId)
            .eq('booking_id', bookingId)
            .maybeSingle();
          const inst = instBefore as
            | { id: string; status: string; amount_cents: number; label: string }
            | null;

          if (!inst) {
            console.error(
              '[webhook] media_installment: installment not found',
              { bookingId, installmentId },
            );
          } else if (inst.status === 'paid') {
            // Already settled — idempotent no-op.
            console.log(
              `[webhook] media_installment already paid — skipping: installment=${installmentId}`,
            );
          } else {
            const nowIso = new Date().toISOString();
            await supabase
              .from('media_payment_installments')
              .update({
                status: 'paid',
                paid_at: nowIso,
                paid_method: paidMethod,
                stripe_payment_intent_id:
                  typeof session.payment_intent === 'string'
                    ? session.payment_intent
                    : null,
              })
              .eq('id', installmentId)
              .eq('booking_id', bookingId)
              // Guard: only flip if still unpaid (race-safe).
              .neq('status', 'paid');

            await supabase.from('media_booking_audit_log').insert({
              booking_id: bookingId,
              action: 'installment_paid',
              performed_by: 'stripe_webhook',
              details: {
                installment_id: installmentId,
                label: inst.label,
                amount_cents: amountPaid || inst.amount_cents,
                paid_method: paidMethod,
                stripe_session_id: session.id,
              },
            });

            console.log(
              `[webhook] media_installment paid: booking=${bookingId} installment=${installmentId} amount=${amountPaid}`,
            );
          }
        }
      } else if (meta.type === 'package_quote') {
        // ── Package quote accepted + paid ─────────────────────────
        // Round D: customer paid for either:
        //   - A one-off package (mode='payment') — single charge, mint
        //     entitlement immediately
        //   - A membership (mode='subscription') — first invoice paid,
        //     mint entitlement covering the full term (Stripe Subscription
        //     handles subsequent monthly invoices via cancel_at)
        //
        // Either way, we mint the entitlement here. Race-safe: the
        // `mintEntitlementFromQuote` helper looks up an existing
        // entitlement by quote_id first, so retries are no-ops.
        const quoteId = meta.quote_id;
        if (!quoteId) {
          console.error('[webhook][package_quote] missing quote_id in metadata');
          await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
          return NextResponse.json({ error: 'Missing quote_id' }, { status: 400 });
        }

        // Pull the quote, template, and template lines so the helper
        // has everything it needs to mint balances.
        const { data: quoteRow, error: qErr } = await supabase
          .from('package_quotes')
          .select('id, template_id, user_id, band_id, status, extends_entitlement_id, total_price_cents, salesperson_name, sales_commission_pct')
          .eq('id', quoteId)
          .maybeSingle();
        if (qErr || !quoteRow) {
          console.error('[webhook][package_quote] quote lookup:', qErr);
          await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
          return NextResponse.json({ error: 'Quote not found' }, { status: 500 });
        }
        type Q = {
          id: string; template_id: string; user_id: string | null; band_id: string | null;
          status: string;
          extends_entitlement_id: string | null;
          total_price_cents: number | null;
          salesperson_name: string | null;
          sales_commission_pct: number | null;
        };
        const quote = quoteRow as Q;

        const [{ data: tplRow }, { data: linesRows }] = await Promise.all([
          supabase
            .from('package_templates')
            .select('is_membership, membership_months, duration_days')
            .eq('id', quote.template_id)
            .single(),
          supabase
            .from('package_template_lines')
            .select('id, kind, quantity, media_offering_id, full_price_cents, package_value_cents, notes')
            .eq('template_id', quote.template_id),
        ]);
        if (!tplRow) {
          console.error('[webhook][package_quote] template missing for quote', quoteId);
          await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
          return NextResponse.json({ error: 'Template missing' }, { status: 500 });
        }
        type Tpl = {
          is_membership: boolean;
          membership_months: number | null;
          duration_days: number | null;
        };
        const tpl = tplRow as Tpl;

        type Line = {
          id: string;
          kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
          quantity: number;
          media_offering_id: string | null;
          full_price_cents: number;
          package_value_cents: number;
          notes: string | null;
        };
        const lines = (linesRows ?? []) as Line[];

        // For memberships, look up the subscription details from
        // the Stripe session so we can stamp the subscription id +
        // initial period end on the entitlement.
        let stripeSubscriptionId: string | undefined;
        let stripeSubscriptionIterations: number | undefined;
        let currentPeriodEnd: string | undefined;
        if (tpl.is_membership && session.subscription) {
          stripeSubscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id;
          stripeSubscriptionIterations = tpl.membership_months ?? undefined;
          // Pull current_period_end from the subscription itself, AND
          // set cancel_at so Stripe stops billing after the contract
          // term (Cole's rule: memberships do NOT auto-renew). We can't
          // set this from the checkout session call because the Stripe
          // SDK type doesn't expose it on subscription_data — but the
          // subscription itself has cancel_at as a first-class field.
          try {
            const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            const cpe = (sub as { current_period_end?: number }).current_period_end;
            if (typeof cpe === 'number') {
              currentPeriodEnd = new Date(cpe * 1000).toISOString();
            }

            // Compute cancel_at: subscription start + months × 30 days
            // (close enough to the membership term boundary; Stripe will
            // cancel on the next billing date after this passes).
            const months = tpl.membership_months ?? 3;
            const startTime = (sub as { current_period_start?: number }).current_period_start
              ?? Math.floor(Date.now() / 1000);
            const cancelAt = startTime + months * 30 * 86400;
            await stripe.subscriptions.update(stripeSubscriptionId, {
              cancel_at: cancelAt,
            });
            console.log(`[webhook][package_quote] subscription ${stripeSubscriptionId} cancel_at=${new Date(cancelAt * 1000).toISOString()}`);
          } catch (e) {
            console.error('[webhook][package_quote] subscription update/retrieve:', e);
            // Non-fatal — entitlement still mints. Admin can manually
            // set cancel_at via Stripe dashboard if this fails.
          }
        }

        try {
          // Round H: extension flow detection. A quote with
          // extends_entitlement_id should EXTEND the existing
          // entitlement (bump ends_at + add proportional balances)
          // rather than mint a new one.
          let result: { entitlementId: string; alreadyMinted: boolean };
          if (quote.extends_entitlement_id) {
            // Compute months: subscription_data.metadata captured
            // membership_months in the create flow. Fallback: derive
            // from the quote's price vs template's per-month price.
            const subMetaMonths = session.subscription
              && stripeSubscriptionIterations
              ? stripeSubscriptionIterations
              : tpl.membership_months ?? 1;
            // Pull total_price_cents from quote to derive months if subscriptions metadata missing.
            const { data: priceRow } = await supabase
              .from('package_quotes')
              .select('total_price_cents')
              .eq('id', quote.id)
              .single();
            const totalPriceCents = (priceRow as { total_price_cents: number } | null)?.total_price_cents ?? 0;
            // Compute monthly cost from template; months = total / monthly
            const { data: monthlyRow } = await supabase
              .from('package_templates')
              .select('price_cents')
              .eq('id', quote.template_id)
              .single();
            const monthly = (monthlyRow as { price_cents: number } | null)?.price_cents ?? 0;
            const derivedMonths = monthly > 0 ? Math.round(totalPriceCents / monthly) : subMetaMonths;
            const monthsToExtend = derivedMonths > 0 ? derivedMonths : subMetaMonths;

            result = await extendEntitlement(
              supabase,
              { ...quote, extends_entitlement_id: quote.extends_entitlement_id },
              tpl,
              lines,
              monthsToExtend,
              {
                stripeCheckoutSessionId: session.id,
                stripeSubscriptionId,
                stripeSubscriptionIterations,
                currentPeriodEnd,
              },
            );
          } else {
            result = await mintEntitlementFromQuote(
              supabase,
              quote,
              tpl,
              lines,
              {
                stripeCheckoutSessionId: session.id,
                stripeSubscriptionId,
                stripeSubscriptionIterations,
                currentPeriodEnd,
              },
            );
          }

          if (result.alreadyMinted) {
            console.log(`[webhook][package_quote] already minted/extended entitlement ${result.entitlementId} — dedup`);
            break;
          }

          console.log(`[webhook][package_quote] ${quote.extends_entitlement_id ? 'extended' : 'minted'} entitlement ${result.entitlementId} for quote ${quote.id}`);

          // Notify admins. Pull recipient identity for the email.
          try {
            let recipientName = 'Recipient';
            let recipientEmail = '';
            if (quote.user_id) {
              const { data: profile } = await supabase
                .from('profiles')
                .select('display_name, email')
                .eq('user_id', quote.user_id)
                .maybeSingle();
              const p = profile as { display_name: string | null; email: string | null } | null;
              if (p) {
                recipientName = p.display_name ?? 'Recipient';
                recipientEmail = p.email ?? '';
              }
            } else if (quote.band_id) {
              const { data: band } = await supabase.from('bands').select('display_name').eq('id', quote.band_id).maybeSingle();
              recipientName = (band as { display_name: string } | null)?.display_name ?? 'Band';
            }
            const tplName = (meta.template_name as string) || 'package';
            const totalCents = session.amount_total ?? 0;
            await sendPackageQuoteAccepted({
              templateName: tplName,
              recipientName,
              recipientEmail,
              totalPriceCents: totalCents,
              isMembership: tpl.is_membership,
              quoteId: quote.id,
            });
          } catch (e) {
            console.error('[webhook][package_quote] admin email error:', e);
          }
        } catch (e) {
          // Roll back the idempotency claim so Stripe retries.
          console.error('[webhook][package_quote] mint failed:', e);
          await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
          return NextResponse.json({ error: 'Mint failed' }, { status: 500 });
        }
      } else if (meta.type === 'credit_redemption_deposit') {
        // ── Free-studio-hour redemption: surcharge/deposit paid (card) ───
        // Shared with the async (Cash App / bank) path via completeCreditRedemption.
        const { retry } = await completeCreditRedemption(supabase, session, meta, event.id, event.type);
        if (retry) {
          await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
          return NextResponse.json({ error: 'Credit-redemption booking not ready — retry' }, { status: 500 });
        }
      }
      break;
    }

    // Cash App Pay, bank transfers, and other async payment methods fire this event
    // instead of (or in addition to) checkout.session.completed. We handle it identically.
    case 'checkout.session.async_payment_succeeded': {
      const asyncSession = event.data.object as Stripe.Checkout.Session;
      const asyncMeta = asyncSession.metadata || {};

      // Only process if we haven't already (check if booking exists).
      // Accepts both 'booking_deposit' (solo) and 'band_booking_deposit'
      // because Cash App / async payments use the same metadata shape.
      if (asyncMeta.type === 'booking_deposit' || asyncMeta.type === 'band_booking_deposit') {
        const { data: existing } = await supabase
          .from('bookings')
          .select('id')
          .eq('stripe_checkout_session_id', asyncSession.id)
          .single();

        if (!existing) {
          // Same logic as checkout.session.completed for booking_deposit
          const startDateTime = `${asyncMeta.session_date}T${padClockHm(asyncMeta.start_time)}:00`;
          const endDateTime = `${asyncMeta.session_date}T${padClockHm(asyncMeta.end_time)}:00`;
          const isAsyncBandBooking = asyncMeta.type === 'band_booking_deposit';
          // Bands always get a priority window even if asyncMeta.engineer is empty —
          // mirrors the sync branch's defense-in-depth so Iszac never gets bypassed.
          const priorityExpiry = (asyncMeta.engineer || isAsyncBandBooking)
            ? calculatePriorityExpiry(startDateTime)
            : null;
          const rescheduleDeadline = calculateRescheduleDeadline(startDateTime);

          const { data: newBooking, error: asyncInsErr } = await supabase.from('bookings').insert({
            customer_name: asyncMeta.customer_name,
            customer_email: asyncMeta.customer_email,
            customer_phone: asyncMeta.customer_phone || null,
            start_time: startDateTime,
            end_time: endDateTime,
            duration: parseFloat(asyncMeta.duration_hours),
            room: asyncMeta.room,
            engineer_name: null,
            requested_engineer: asyncMeta.engineer || null,
            total_amount: parseInt(asyncMeta.total_amount),
            deposit_amount: parseInt(asyncMeta.deposit_amount),
            remainder_amount: parseInt(asyncMeta.remainder_amount),
            actual_deposit_paid: asyncSession.amount_total,
            night_fees_amount: parseInt(asyncMeta.night_fees || '0'),
            same_day_fee: asyncMeta.same_day === 'true',
            same_day_fee_amount: parseInt(asyncMeta.same_day_fee || '0'),
            stripe_customer_id: asyncSession.customer as string,
            stripe_checkout_session_id: asyncSession.id,
            stripe_payment_intent_id: asyncSession.payment_intent as string,
            // Deposit paid, no engineer yet → 'pending' (Awaiting Engineer).
            status: 'pending',
            priority_expires_at: priorityExpiry,
            reschedule_deadline: rescheduleDeadline,
            admin_notes: asyncMeta.notes || null,
            band_id: asyncMeta.band_id || null,
            // Free setup hour padding (migration 041) — same shape as the
            // sync branch above. Async (Cash App / bank transfer) bookings
            // need to honor this too or the calendar would under-block.
            setup_minutes_before: parseInt(asyncMeta.setup_minutes_before || '0', 10) || 0,
          }).select().single();
          if (asyncInsErr || !newBooking) {
            console.error('[webhook] async-payment booking insert failed — rolling back claim:', asyncInsErr);
            await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
            return NextResponse.json(
              { error: asyncInsErr?.message || 'Async booking insert failed' },
              { status: 500 },
            );
          }

          // Send all emails — bookings.start_time is wall-clock-as-UTC → fmtSession*
          const dateStr = fmtSessionDate(startDateTime, { weekday: 'long', month: 'long', day: 'numeric' });
          const timeStr = fmtSessionTime(startDateTime);
          const duration = parseFloat(asyncMeta.duration_hours);

          await sendBookingConfirmation(asyncMeta.customer_email, {
            customerName: asyncMeta.customer_name, date: dateStr, startTime: timeStr,
            duration, room: asyncMeta.room, total: parseInt(asyncMeta.total_amount),
            deposit: asyncSession.amount_total || parseInt(asyncMeta.deposit_amount),
            bookingId: newBooking?.id,
          });

          await sendAdminBookingAlert({
            id: newBooking?.id || '', customerName: asyncMeta.customer_name,
            customerEmail: asyncMeta.customer_email, date: dateStr, startTime: timeStr,
            duration, room: asyncMeta.room, total: parseInt(asyncMeta.total_amount),
          });

          const room = asyncMeta.room as string;
          if (isAsyncBandBooking) {
            // Band sessions: always Iszac, never fan out — same routing as
            // the sync branch above. Iszac reschedules with the band directly
            // if he can't take it; no other engineer can claim a band session.
            const iszac = ENGINEERS.find((e) => e.displayName === 'Iszac');
            if (iszac && priorityExpiry) {
              const priorityLabel = getPriorityHoursLabel(priorityExpiry);
              await sendEngineerPriorityAlert(iszac.email, {
                id: newBooking?.id || '', customerName: asyncMeta.customer_name,
                date: dateStr, startTime: timeStr, duration, room: asyncMeta.room,
                priorityHours: priorityLabel,
              });
            }
          } else if (asyncMeta.engineer && priorityExpiry) {
            const requestedEng = ENGINEERS.find(
              (e) => e.name === asyncMeta.engineer || e.displayName === asyncMeta.engineer
            );
            if (requestedEng) {
              const priorityLabel = getPriorityHoursLabel(priorityExpiry);
              await sendEngineerPriorityAlert(requestedEng.email, {
                id: newBooking?.id || '', customerName: asyncMeta.customer_name,
                date: dateStr, startTime: timeStr, duration, room: asyncMeta.room,
                priorityHours: priorityLabel,
              });
            }
          } else {
            const engineerEmails = ENGINEERS
              .filter((e) => e.studios.includes(room as Room))
              .map((e) => e.email);
            if (engineerEmails.length > 0) {
              await sendEngineerNewBookingAlert(engineerEmails, {
                id: newBooking?.id || '', customerName: asyncMeta.customer_name,
                date: dateStr, startTime: timeStr, duration, room: asyncMeta.room,
              });
            }
          }
        }
      } else if (asyncMeta.type === 'invite_deposit') {
        // Check if already confirmed
        const bookingId = asyncMeta.booking_id;
        const { data: existingBooking } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (existingBooking && existingBooking.status !== 'confirmed') {
          await supabase.from('bookings').update({
            // Confirmed only if the invite already names an engineer; else 'pending'.
            status: paidBookingStatus(existingBooking.engineer_name),
            actual_deposit_paid: asyncSession.amount_total,
            stripe_customer_id: asyncSession.customer as string,
            stripe_checkout_session_id: asyncSession.id,
            stripe_payment_intent_id: asyncSession.payment_intent as string,
            updated_at: new Date().toISOString(),
          }).eq('id', bookingId);

          // Create media_sales records if booking has media add-ons (with dedup check)
          const asyncMediaAddons = existingBooking.media_addons;
          if (asyncMediaAddons && Array.isArray(asyncMediaAddons) && asyncMediaAddons.length > 0) {
            const { data: existingAsyncSales } = await supabase
              .from('media_sales')
              .select('id')
              .eq('booking_id', bookingId)
              .limit(1);

            if (!existingAsyncSales?.length) {
              for (const addon of asyncMediaAddons) {
                await supabase.from('media_sales').insert({
                  description: addon.description || addon.type,
                  amount: addon.amount,
                  sale_type: addon.type,
                  sold_by: addon.sold_by || null,
                  filmed_by: addon.filmed_by || null,
                  edited_by: addon.edited_by || null,
                  client_name: existingBooking.customer_name,
                  client_email: existingBooking.customer_email,
                  booking_id: bookingId,
                  notes: `From session invite`,
                });
              }
            }
          }

          // bookings.start_time is wall-clock-as-UTC → fmtSession*
          const dateStr = fmtSessionDate(existingBooking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
          const timeStr = fmtSessionTime(existingBooking.start_time);

          if (existingBooking.customer_email) {
            await sendBookingConfirmation(existingBooking.customer_email, {
              customerName: existingBooking.customer_name, date: dateStr, startTime: timeStr,
              duration: existingBooking.duration, room: existingBooking.room || '',
              total: existingBooking.total_amount,
              deposit: asyncSession.amount_total || existingBooking.deposit_amount,
              bookingId,
            });
          }

          await sendAdminBookingAlert({
            id: bookingId, customerName: existingBooking.customer_name,
            customerEmail: existingBooking.customer_email || '', date: dateStr, startTime: timeStr,
            duration: existingBooking.duration, room: existingBooking.room || '',
            total: existingBooking.total_amount,
          });

          // Engineer notifications
          const invitePriorityExpiry = existingBooking.requested_engineer
            ? calculatePriorityExpiry(existingBooking.start_time) : null;
          const inviteRescheduleDeadline = calculateRescheduleDeadline(existingBooking.start_time);

          await supabase.from('bookings').update({
            priority_expires_at: invitePriorityExpiry,
            reschedule_deadline: inviteRescheduleDeadline,
          }).eq('id', bookingId);

          // Skip claim emails if engineer already assigned (invite sessions)
          if (!existingBooking.engineer_name) {
            const room = existingBooking.room as string;
            if (existingBooking.requested_engineer && invitePriorityExpiry) {
              const requestedEng = ENGINEERS.find(
                (e) => e.name === existingBooking.requested_engineer || e.displayName === existingBooking.requested_engineer
              );
              if (requestedEng) {
                const priorityLabel = getPriorityHoursLabel(invitePriorityExpiry);
                await sendEngineerPriorityAlert(requestedEng.email, {
                  id: bookingId, customerName: existingBooking.customer_name,
                  date: dateStr, startTime: timeStr, duration: existingBooking.duration,
                  room: existingBooking.room || '', priorityHours: priorityLabel,
                });
              }
            } else {
              const engineerEmails = ENGINEERS
                .filter((e) => e.studios.includes(room as Room))
                .map((e) => e.email);
              if (engineerEmails.length > 0) {
                await sendEngineerNewBookingAlert(engineerEmails, {
                  id: bookingId, customerName: existingBooking.customer_name,
                  date: dateStr, startTime: timeStr, duration: existingBooking.duration,
                  room: existingBooking.room || '',
                });
              }
            }
          }
        }
      } else if (asyncMeta.type === 'booking_remainder') {
        const bookingId = asyncMeta.booking_id;
        const chargeAmount = parseInt(asyncMeta.charge_amount || '0') || (asyncSession.amount_total || 0);
        const { data: remainderBooking } = await supabase
          .from('bookings')
          .select('remainder_amount')
          .eq('id', bookingId)
          .single();

        if (remainderBooking) {
          await supabase.from('bookings').update({
            remainder_amount: Math.max(0, remainderBooking.remainder_amount - chargeAmount),
            updated_at: new Date().toISOString(),
          }).eq('id', bookingId);
        }
      } else if (asyncMeta.type === 'media_remainder' || asyncMeta.type === 'media_manual') {
        // ── Media Hub: async-payment completion (Cash App / bank xfer) ──
        // Mirrors the synchronous handler in checkout.session.completed.
        // Same idempotency rules: only stamp final_paid_at if it wasn't
        // already set, and never apply more than (final_price_cents -
        // previously_paid).
        const bookingId = asyncMeta.booking_id;
        const amountPaid = asyncSession.amount_total || 0;
        const isResend = asyncMeta.resend === 'true';

        if (bookingId && amountPaid > 0) {
          const { data: rowBefore } = await supabase
            .from('media_bookings')
            .select('final_price_cents, deposit_cents, actual_deposit_paid, final_paid_at')
            .eq('id', bookingId)
            .maybeSingle();

          type MediaRow = {
            final_price_cents: number;
            deposit_cents: number | null;
            actual_deposit_paid: number | null;
            final_paid_at: string | null;
          };
          const row = rowBefore as MediaRow | null;

          if (row) {
            const previousPaid = row.actual_deposit_paid ?? 0;
            const newPaid = Math.min(row.final_price_cents, previousPaid + amountPaid);
            const newRemainder = Math.max(0, row.final_price_cents - newPaid);

            const updates: Record<string, unknown> = {
              actual_deposit_paid: newPaid,
            };
            if (newRemainder === 0 && !row.final_paid_at) {
              const nowIso = new Date().toISOString();
              updates.final_paid_at = nowIso;
              updates.remainder_paid_at = nowIso;
              if (asyncMeta.type === 'media_manual') {
                updates.status = 'deposited';
                updates.deposit_paid_at = nowIso;
                updates.deposit_cents = newPaid;
                updates.stripe_session_id = asyncSession.id;
                if (typeof asyncSession.payment_intent === 'string') {
                  updates.stripe_payment_intent_id = asyncSession.payment_intent;
                }
              }
            }

            await supabase
              .from('media_bookings')
              .update(updates)
              .eq('id', bookingId);

            const action =
              asyncMeta.type === 'media_manual'
                ? 'manual_link_completed_async'
                : isResend
                ? 'remainder_link_resend_completed_async'
                : 'remainder_link_completed_async';

            await supabase.from('media_booking_audit_log').insert({
              booking_id: bookingId,
              action,
              performed_by: 'stripe_webhook',
              details: {
                amount_cents: amountPaid,
                previous_paid: previousPaid,
                new_paid: newPaid,
                new_remainder: newRemainder,
                stripe_session_id: asyncSession.id,
                resend: isResend,
                async: true,
              },
            });
          }
        }
      } else if (asyncMeta.type === 'credit_redemption_deposit') {
        // ── Free-studio-hour redemption paid via Cash App / bank transfer ──
        // Same completion as the card path; the helper is idempotent so if
        // both the sync + async events somehow fire, the credit drains once.
        const { retry } = await completeCreditRedemption(
          supabase, asyncSession, asyncMeta, event.id, event.type,
        );
        if (retry) {
          await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
          return NextResponse.json({ error: 'Credit-redemption booking not ready — retry' }, { status: 500 });
        }
      }
      break;
    }

    // Handle failed async payments (Cash App declined, etc.)
    case 'checkout.session.async_payment_failed': {
      const failedSession = event.data.object as Stripe.Checkout.Session;
      const failedMeta = failedSession.metadata || {};
      console.error('Async payment failed:', failedSession.id, failedMeta);
      // If this was an invite, mark it back to pending
      if (failedMeta.type === 'invite_deposit' && failedMeta.booking_id) {
        await supabase.from('bookings').update({
          status: 'pending_deposit',
          updated_at: new Date().toISOString(),
        }).eq('id', failedMeta.booking_id);
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      // Update booking status if refunded
      if (charge.payment_intent) {
        await supabase.from('bookings')
          .update({ status: 'cancelled' })
          .eq('stripe_payment_intent_id', charge.payment_intent as string);
      }
      break;
    }

    case 'invoice.payment_failed': {
      // Round D: a monthly membership invoice failed (declined card,
      // expired card, etc.). Stripe retries 4× over ~3 weeks per its
      // dunning schedule, then cancels the subscription. Per Cole's
      // policy: the entitlement stays USABLE — payment_status flips to
      // 'past_due' so admin can see what's outstanding without losing
      // the customer's access. Admin escalates to 'collections' or
      // 'written_off' manually.
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as { subscription?: string | Stripe.Subscription }).subscription;
      const subscriptionId = typeof subId === 'string' ? subId : subId?.id;
      if (!subscriptionId) break;

      const { data: ent } = await supabase
        .from('package_entitlements')
        .select('id, payment_status')
        .eq('stripe_subscription_id', subscriptionId)
        .maybeSingle();
      if (!ent) {
        // Not one of our package memberships — could be an unrelated
        // subscription that the same Stripe account uses elsewhere.
        // Ignore.
        break;
      }
      type E = { id: string; payment_status: string };
      const entRow = ent as E;
      // Only flip from 'current'; don't downgrade 'collections' or
      // 'written_off' just because another retry came in.
      if (entRow.payment_status === 'current') {
        await supabase
          .from('package_entitlements')
          .update({
            payment_status: 'past_due',
            last_payment_failed_at: new Date().toISOString(),
          })
          .eq('id', entRow.id);
        console.log(`[webhook][invoice.payment_failed] entitlement ${entRow.id} → past_due`);
      } else {
        console.log(`[webhook][invoice.payment_failed] entitlement ${entRow.id} already ${entRow.payment_status} — left alone`);
      }
      break;
    }

    case 'invoice.paid': {
      // Round D: a monthly membership invoice succeeded. If the
      // entitlement is past_due (failed payment in a prior cycle that
      // now succeeded), flip it back to 'current'. Also bump
      // current_period_end so admin sees the next billing date.
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as { subscription?: string | Stripe.Subscription }).subscription;
      const subscriptionId = typeof subId === 'string' ? subId : subId?.id;
      if (!subscriptionId) break;

      const { data: ent } = await supabase
        .from('package_entitlements')
        .select('id, payment_status')
        .eq('stripe_subscription_id', subscriptionId)
        .maybeSingle();
      if (!ent) break;
      const entRow = ent as { id: string; payment_status: string };

      const periodEnd = (invoice as { period_end?: number }).period_end;
      const updates: Record<string, unknown> = {};
      if (entRow.payment_status === 'past_due') {
        updates.payment_status = 'current';
      }
      if (typeof periodEnd === 'number') {
        updates.current_period_end = new Date(periodEnd * 1000).toISOString();
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('package_entitlements').update(updates).eq('id', entRow.id);
      }
      break;
    }
  }

  // ── Silent-fall-through detection ────────────────────────────────────
  // checkout.session.completed must always be handled by ONE of the
  // branches above (booking_deposit, beat_purchase, media_purchase,
  // package_quote, etc.) WHEN the payment originated from our site. We
  // distinguish two cases:
  //
  //   1. metadata.type is MISSING entirely (no `type` field at all) —
  //      the payment did not originate from this site. The most common
  //      source is a Stripe-Dashboard-created payment link used for an
  //      unrelated client / off-platform invoice. ACK 200 silently so
  //      Stripe stops retrying and admins don't get spammed. The
  //      Stripe dashboard remains the source of truth for those.
  //
  //   2. metadata.type is PRESENT but not recognized — the site created
  //      this checkout but no branch above handled it. This is a real
  //      bug (the May 8-10 outage signature). Alert + 500 so Stripe
  //      retries while we deploy a fix.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = (session.metadata || {}) as Record<string, string>;
    const knownTypes = new Set([
      'booking_deposit', 'band_booking_deposit',
      'invite_deposit', 'booking_remainder',
      'beat_purchase', 'beat_renewal', 'beat_upgrade', 'private_beat_sale',
      'media_purchase', 'media_remainder', 'media_manual',
      'package_quote',
    ]);
    if (!meta.type) {
      // External payment (Stripe Dashboard or another integration).
      // Don't alert and don't ask Stripe to retry — just ACK.
      console.log(
        `[webhook] checkout.session.completed event ${event.id} has no metadata.type — treating as external payment, ACKing without action`,
      );
      return NextResponse.json({ received: true, external: true });
    }
    if (!knownTypes.has(meta.type)) {
      console.error(
        `[webhook] checkout.session.completed event ${event.id} fell through — unknown meta.type='${meta.type}'`,
      );
      await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
      await alertAdminOfWebhookFailure({
        eventId: event.id,
        eventType: event.type,
        reason: `Unrecognized metadata.type: '${meta.type}'. Stripe will retry.`,
        metadata: meta,
        paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        amount: session.amount_total,
      });
      return NextResponse.json(
        { error: `Unknown metadata.type: ${meta.type}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ received: true });
  } catch (uncaught) {
    // ── Uncaught failure — recover the claim + alert admin ────────────
    // This is the safety net that ensures a paid customer never silently
    // disappears. Whatever threw, we delete the claim so Stripe retries
    // (giving us another chance once the bug is fixed) and email admins
    // immediately so they can intervene if needed.
    console.error('[webhook] UNCAUGHT exception — rolling back claim:', uncaught);
    try {
      await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
    } catch (rollbackErr) {
      console.error('[webhook] rollback delete also failed:', rollbackErr);
    }
    let metaForAlert: Record<string, string> | undefined;
    let paymentIntent: string | null = null;
    let amount: number | null = null;
    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        metaForAlert = (session.metadata || {}) as Record<string, string>;
        paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : null;
        amount = session.amount_total ?? null;
      }
    } catch { /* ignore */ }
    await alertAdminOfWebhookFailure({
      eventId: event.id,
      eventType: event.type,
      reason: `Uncaught exception: ${uncaught instanceof Error ? uncaught.message : String(uncaught)}`,
      metadata: metaForAlert,
      paymentIntent,
      amount,
    });
    return NextResponse.json(
      { error: 'Webhook handler exception — Stripe will retry' },
      { status: 500 },
    );
  }
}
