// scripts/recover-brayner-booking.ts
//
// One-off recovery for the 2026-06-06 webhook incident: a paid Studio B 9 AM
// deposit (evt_1TfVg7…, pi_3TfVg5…) crashed the webhook ("Invalid time value",
// single-digit hour) so no booking row was created. The customer was charged.
//
// This re-runs the webhook's solo-booking workflow from the REAL live Stripe
// session: insert the booking (status confirmed), claim the event id so any
// later Stripe auto-retry dedups (no double-create), then send the customer
// confirmation + admin alert + requested-engineer priority notification —
// reusing the app's own lib functions so the emails are identical to production.
//
// DRY RUN by default (read-only: retrieves the event + shows the row). Pass
// --apply to perform the writes + send the notifications. Idempotent: aborts
// if a booking for this payment intent already exists.

import { stripe } from '../lib/stripe';
import { createServiceClient } from '../lib/supabase/server';
import { ENGINEERS } from '../lib/constants';
import { calculatePriorityExpiry, getPriorityHoursLabel, calculateRescheduleDeadline } from '../lib/priority';
import { fmtSessionDate, fmtSessionTime } from '../lib/studio-time';
import { sendBookingConfirmation, sendAdminBookingAlert, sendEngineerPriorityAlert } from '../lib/email';

const EVENT_ID = 'evt_1TfVg7GLKrGlFRBUo9v803Oa';
const APPLY = process.argv.includes('--apply');

const padClockHm = (t: string) => {
  const [h = '0', m = '00'] = String(t ?? '').split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
};

async function main() {
  const db = createServiceClient();

  // 1) Pull the REAL event/session from LIVE Stripe (authoritative data).
  const event = await stripe.events.retrieve(EVENT_ID);
  const session = event.data.object as {
    id: string; customer: string | null; payment_intent: string | null;
    amount_total: number | null; payment_status: string; metadata: Record<string, string> | null;
  };
  const meta = session.metadata || {};
  console.log('=== LIVE event ===');
  console.log('event   :', event.id, '| type:', event.type, '| livemode:', (event as { livemode?: boolean }).livemode);
  console.log('session :', session.id);
  console.log('pi      :', session.payment_intent);
  console.log('customer:', session.customer);
  console.log('charged :', session.amount_total, '| payment_status:', session.payment_status);
  console.log('meta    :', JSON.stringify(meta));

  if (event.type !== 'checkout.session.completed' || (meta.type !== 'booking_deposit' && meta.type !== 'band_booking_deposit')) {
    console.log('Not a session booking deposit — aborting.'); return;
  }
  if (session.payment_status !== 'paid') {
    console.log(`payment_status is "${session.payment_status}" (not paid) — aborting, no session owed.`); return;
  }

  // 2) Idempotency guard.
  const pi = session.payment_intent as string;
  const { data: existing } = await db.from('bookings')
    .select('id, status, start_time, created_at').eq('stripe_payment_intent_id', pi).limit(1);
  if (existing && existing.length) {
    console.log('\nBooking ALREADY EXISTS for this payment intent:', existing[0]);
    console.log('Nothing to do (no double-create).'); return;
  }

  // 3) Build the row exactly as the (fixed) webhook would — PADDED times.
  const startDateTime = `${meta.session_date}T${padClockHm(meta.start_time)}:00`;
  const endDateTime = `${meta.session_date}T${padClockHm(meta.end_time)}:00`;
  const duration = parseFloat(meta.duration_hours);
  const priorityExpiry = meta.engineer ? calculatePriorityExpiry(startDateTime) : null;
  const rescheduleDeadline = calculateRescheduleDeadline(startDateTime);
  const dateStr = fmtSessionDate(startDateTime, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = fmtSessionTime(startDateTime);

  const row = {
    customer_name: meta.customer_name,
    customer_email: meta.customer_email,
    customer_phone: meta.customer_phone || null,
    start_time: startDateTime,
    end_time: endDateTime,
    duration,
    room: meta.room,
    engineer_name: null,
    requested_engineer: meta.engineer || null,
    total_amount: parseInt(meta.total_amount),
    deposit_amount: parseInt(meta.deposit_amount),
    remainder_amount: parseInt(meta.remainder_amount),
    actual_deposit_paid: session.amount_total,
    service_value_cents: parseInt(meta.service_value_cents || meta.total_amount),
    reward_grant_id: meta.applied_discount_grant_id || null,
    night_fees_amount: parseInt(meta.night_fees || '0'),
    same_day_fee: meta.same_day === 'true',
    same_day_fee_amount: parseInt(meta.same_day_fee || '0'),
    guest_count: parseInt(meta.guest_count || '1'),
    guest_fee_amount: parseInt(meta.guest_fee || '0'),
    stripe_customer_id: session.customer,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: pi,
    status: 'confirmed',
    priority_expires_at: priorityExpiry,
    reschedule_deadline: rescheduleDeadline,
    admin_notes: meta.notes || null,
    band_id: meta.band_id || null,
    setup_minutes_before: parseInt(meta.setup_minutes_before || '0', 10) || 0,
    sweet_spot_addon: null,
  };
  const eng = meta.engineer ? ENGINEERS.find((e) => e.name === meta.engineer || e.displayName === meta.engineer) : null;
  console.log('\n=== Booking row to insert ===');
  console.log(JSON.stringify(row, null, 2));
  console.log('start/end (padded):', startDateTime, '→', endDateTime);
  console.log('engineer to notify:', eng ? `${eng.displayName || eng.name} <${eng.email}>` : `(none / "${meta.engineer}" not in roster)`);

  if (!APPLY) {
    console.log('\n── DRY RUN ── re-run with --apply to insert + claim + send 3 emails.');
    return;
  }

  // 4) Claim the event so a later Stripe auto-retry dedups (prevents double-create).
  const { error: claimErr } = await db.from('stripe_webhook_events').insert({ event_id: event.id, event_type: event.type });
  if (claimErr && claimErr.code !== '23505') { console.error('Claim insert failed:', claimErr); return; }
  if (claimErr?.code === '23505') {
    const { data: e2 } = await db.from('bookings').select('id').eq('stripe_payment_intent_id', pi).limit(1);
    if (e2?.length) { console.log('Webhook already recovered it (claim + booking present). Done.'); return; }
  }

  // 5) Insert the booking.
  const { data: inserted, error: insErr } = await db.from('bookings').insert(row).select('id').single();
  if (insErr || !inserted) {
    console.error('Booking insert FAILED — rolling back claim:', insErr);
    await db.from('stripe_webhook_events').delete().eq('event_id', event.id);
    return;
  }
  console.log('\n✅ Booking created:', inserted.id);

  // 6) Notifications (same lib functions the webhook uses).
  await sendBookingConfirmation(meta.customer_email, {
    customerName: meta.customer_name, date: dateStr, startTime: timeStr, duration,
    room: meta.room, total: parseInt(meta.total_amount),
    deposit: session.amount_total || parseInt(meta.deposit_amount), bookingId: inserted.id,
  });
  console.log('✅ Customer confirmation →', meta.customer_email);

  await sendAdminBookingAlert({
    id: inserted.id, customerName: meta.customer_name, customerEmail: meta.customer_email,
    date: dateStr, startTime: timeStr, duration, room: meta.room, total: parseInt(meta.total_amount),
  });
  console.log('✅ Admin alert sent');

  if (eng && priorityExpiry) {
    await sendEngineerPriorityAlert(eng.email, {
      id: inserted.id, customerName: meta.customer_name, date: dateStr, startTime: timeStr,
      duration, room: meta.room, priorityHours: getPriorityHoursLabel(priorityExpiry),
    });
    console.log('✅ Engineer priority alert →', eng.email, `(${meta.engineer})`);
  } else {
    console.warn('⚠ No engineer notified (requested engineer not resolved).');
  }

  console.log('\n✅ RECOVERY COMPLETE — booking visible, engineer notified, customer confirmed.');
  console.log('   (XP award skipped — best-effort gamification only; recover manually if Brayner has an account.)');
}

main().catch((e) => { console.error(e); process.exit(1); });
