// scripts/sweep-stuck-bookings.ts
// Incident sweep: find PAID booking-deposit checkout sessions in LIVE Stripe
// that have NO booking row (charged but no session created) — the failure mode
// of the single-digit-hour webhook crash. Read-only. Flags single-digit-hour
// start times (the known bug) vs other causes.
import { stripe } from '../lib/stripe';
import { createServiceClient } from '../lib/supabase/server';

const MAX_SESSIONS = 600; // ~ a few months of history; bump if needed

async function main() {
  const db = createServiceClient();
  let scanned = 0, deposits = 0, stuck = 0;
  const stuckRows: string[] = [];
  let startingAfter: string | undefined;

  while (scanned < MAX_SESSIONS) {
    const page = await stripe.checkout.sessions.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    if (!page.data.length) break;
    for (const s of page.data) {
      scanned++;
      const m = s.metadata || {};
      const isBookingDeposit = m.type === 'booking_deposit' || m.type === 'band_booking_deposit';
      if (!isBookingDeposit) continue;
      if (s.payment_status !== 'paid') continue; // only money actually taken
      deposits++;
      const pi = s.payment_intent as string | null;
      if (!pi) continue;
      const { data } = await db.from('bookings').select('id').eq('stripe_payment_intent_id', pi).limit(1);
      if (data && data.length) continue; // booking exists → fine
      stuck++;
      const st = m.start_time || '?';
      const singleDigit = /^\d:/.test(st); // "9:00" → bug; "11:00" → other cause
      stuckRows.push(
        `STUCK ${singleDigit ? '⚠SINGLE-DIGIT-HOUR' : '(other)'} | ${m.customer_name || '?'} <${m.customer_email || '?'}> | ${m.room} ${m.session_date} ${st}-${m.end_time} | charged ${s.amount_total} | pi=${pi} | evt-session=${s.id}`,
      );
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  console.log(`Scanned ${scanned} checkout sessions; ${deposits} paid booking-deposits; ${stuck} STUCK (no booking row).`);
  if (stuck === 0) console.log('✅ No other stuck bookings — Brayner was the only victim.');
  else { console.log('— stuck —'); stuckRows.forEach((r) => console.log('  ' + r)); }
}
main().catch((e) => { console.error(e); process.exit(1); });
