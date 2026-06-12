/**
 * scripts/seed-test-bookings.ts
 *
 * Seeds 3 media + 3 band test bookings + fires the same notification
 * emails the live webhook would. Mirrors the side effects of
 * /api/booking/webhook so admin (Cole + Jay) and Iszac see test data
 * exactly as if real customers had paid.
 *
 * Cleanup contract:
 *   • media_bookings rows: is_test = TRUE → auto-excluded from accounting.
 *     Drop with: DELETE FROM media_bookings WHERE is_test = TRUE;
 *   • bookings rows: customer_email LIKE '%@sweetdreams.test' → these are
 *     the only test rows we mint here. Drop with:
 *     DELETE FROM bookings WHERE customer_email LIKE '%@sweetdreams.test';
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/seed-test-bookings.ts
 *
 * Stripe test customers (already minted via MCP, test mode):
 *   cus_USICIKBAPngULY  Single Drop buyer
 *   cus_USICsewnNdBDXt  Photo Session buyer
 *   cus_USICOKMuiKxXfe  EP Package buyer
 *   cus_USICjYpdCnkBnG  Band 4hr booker
 *   cus_USICLrlnWZoW9Q  Band 8hr Sweet Spot booker
 *   cus_USIC0jCKng0xQ7  Band 24hr 3-Day booker
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import {
  sendBookingConfirmation,
  sendAdminBookingAlert,
  sendEngineerPriorityAlert,
  sendMediaPurchaseConfirmation,
  sendMediaPurchaseAdminAlert,
} from '../lib/email';
import { calculatePriorityExpiry, calculateRescheduleDeadline, getPriorityHoursLabel } from '../lib/priority';

// ── Sanity: env vars ───────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!RESEND_KEY) {
  console.warn('[warn] RESEND_API_KEY missing — emails will be skipped, rows still inserted');
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const ISZAC_EMAIL = 'iisszzaacc@gmail.com';
const ISZAC_NAME = 'Iszac Griner';

// Future date helpers — push test sessions ~7-10 days out so engineer
// priority window is wide open and admin can see scheduling-stage bookings.
const baseStart = new Date();
baseStart.setDate(baseStart.getDate() + 7);
baseStart.setUTCHours(19, 0, 0, 0); // 7 PM UTC = ~3 PM Fort Wayne local

function dateOnly(d: Date): string {
  return d.toISOString().split('T')[0];
}
function timeOnly(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 60 * 60 * 1000);
}
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

async function getOfferingId(slug: string): Promise<string> {
  const { data, error } = await supabase
    .from('media_offerings')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) throw new Error(`Offering ${slug} not found: ${error?.message}`);
  return data.id;
}

async function pickAdminUserId(): Promise<string> {
  // Use Cole's profile as the test buyer for media (so he sees them on
  // his own dashboard /dashboard/media/orders). Falls back to any admin.
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email')
    .or('email.eq.cole@sweetdreamsmusic.com,email.eq.cole@sweetdreams.us,email.eq.cole@marcuccilli.com,role.eq.admin')
    .limit(1)
    .maybeSingle();
  if (error || !data?.user_id) throw new Error(`No admin profile found: ${error?.message}`);
  return data.user_id;
}

// ──────────────────────────────────────────────────────────────────────
// MEDIA BOOKINGS
// ──────────────────────────────────────────────────────────────────────
async function seedMediaBookings(buyerUserId: string): Promise<void> {
  console.log('\n─── MEDIA BOOKINGS ─────────────────────────────────────');

  const cases = [
    {
      slug: 'package-single-drop',
      title: 'Single Drop',
      price: 85000,
      hours: 3,
      buyerEmail: 'cole+test-media-1@sweetdreams.us',
      buyerName: 'Test Media — Single Drop',
      stripeCustomerId: 'cus_USICIKBAPngULY',
      configured_components: {
        selections: {
          shorts: { tier: 'mid' },
          photo_session: { skip: false },
        },
      },
      project_details: {
        artist_name: 'Test Artist 001',
        song_title: 'Demo Track Alpha',
        genre: 'Hip-Hop',
        release_target: 'Within 30 days',
        notes: '[TEST DATA] Want a high-energy storyboard. Open to creative direction on the shorts.',
      },
      configurationLines: ['Shorts: mid tier (+$150)', 'Photo session: included'],
    },
    {
      slug: 'photo-session',
      title: 'Photo Session',
      price: 20000,
      hours: 0,
      buyerEmail: 'cole+test-media-2@sweetdreams.us',
      buyerName: 'Test Media — Photo Session',
      stripeCustomerId: 'cus_USICsewnNdBDXt',
      configured_components: { selections: {} },
      project_details: {
        purpose: 'Cover art + press shots',
        outfit_count: 2,
        notes: '[TEST DATA] Indoor studio, moody lighting preferred.',
      },
      configurationLines: [],
    },
    {
      slug: 'package-ep',
      title: 'EP Package',
      price: 250000,
      hours: 6,
      buyerEmail: 'cole+test-media-3@sweetdreams.us',
      buyerName: 'Test Media — EP Package',
      stripeCustomerId: 'cus_USICOKMuiKxXfe',
      configured_components: {
        selections: {
          shorts: { tier: 'premium' },
          music_video: { tier: 'premium' },
          photo_sessions: { skip: false },
        },
      },
      project_details: {
        artist_name: 'Test Artist 002',
        ep_name: 'Demo EP',
        song_count: 4,
        release_target: 'Q3 rollout',
        notes: '[TEST DATA] Multi-location music video, would love a beach + warehouse combo.',
      },
      configurationLines: [
        'Shorts: premium tier (+$1,440)',
        'Music video: premium (+$1,000)',
        '2 photo sessions: included',
      ],
    },
  ];

  for (const c of cases) {
    const offeringId = await getOfferingId(c.slug);
    const fakePI = `TEST-PI-${randomUUID()}`;
    const fakeSession = `TEST-SESSION-${randomUUID()}`;
    const deposit = Math.floor(c.price * 0.5);

    // Insert media_bookings row — mirrors the webhook media_purchase branch
    const { data: row, error: insertErr } = await supabase
      .from('media_bookings')
      .insert({
        offering_id: offeringId,
        user_id: buyerUserId,
        band_id: null,
        status: 'deposited',
        configured_components: c.configured_components,
        project_details: c.project_details,
        final_price_cents: c.price,
        deposit_cents: deposit,
        actual_deposit_paid: deposit, // Pretend the deposit was paid
        customer_phone: '+12605551234',
        is_test: true,
        stripe_payment_intent_id: fakePI,
        stripe_session_id: fakeSession,
        deposit_paid_at: new Date().toISOString(),
        final_paid_at: null, // Remainder still owed
        created_by: 'seed-test-bookings.ts',
      })
      .select('id')
      .single();

    if (insertErr || !row) {
      console.error(`  [media] insert ${c.slug} failed:`, insertErr);
      continue;
    }
    console.log(`  ✓ media_bookings ${c.slug} → ${row.id}`);

    // Audit row
    await supabase.from('media_booking_audit_log').insert({
      booking_id: row.id,
      action: 'test_seed_created',
      performed_by: 'seed-test-bookings.ts',
      details: {
        offering_slug: c.slug,
        full_price_cents: c.price,
        deposit_simulated_cents: deposit,
        stripe_test_customer_id: c.stripeCustomerId,
        stripe_test_payment_intent_id: fakePI,
      },
    });

    // Studio credits if package includes hours
    if (c.hours > 0) {
      await supabase.from('studio_credits').insert({
        user_id: buyerUserId,
        band_id: null,
        source_booking_id: row.id,
        hours_granted: c.hours,
        hours_used: 0,
        cost_basis_cents: deposit,
      });
      console.log(`    + studio_credits: ${c.hours} hours granted`);
    }

    // Buyer confirmation email (goes to the +test-media-N alias → Cole sees it)
    await sendMediaPurchaseConfirmation(c.buyerEmail, {
      buyerName: c.buyerName,
      offeringTitle: `[TEST] ${c.title}`,
      amountPaid: deposit,
      studioHoursIncluded: c.hours,
      bandAttached: false,
      configurationLines: c.configurationLines,
      bookingId: row.id,
    });

    // Admin alert (goes to Cole + Jay)
    await sendMediaPurchaseAdminAlert({
      buyerName: `[TEST] ${c.buyerName}`,
      buyerEmail: c.buyerEmail,
      offeringTitle: c.title,
      amountPaid: deposit,
      studioHoursIncluded: c.hours,
      bandAttached: false,
      configurationLines: c.configurationLines,
      customerPhone: '+12605551234',
      fullPriceTotal: c.price,
      depositPaid: deposit,
      cartItemCount: 1,
    });
    console.log(`    ✉ buyer + admin emails sent`);
  }
}

// ──────────────────────────────────────────────────────────────────────
// BAND BOOKINGS — bookings table (no is_test column)
// ──────────────────────────────────────────────────────────────────────
async function seedBandBookings(): Promise<void> {
  console.log('\n─── BAND BOOKINGS (Iszac as requested engineer) ────────');

  // Try to find an existing band the user can be associated with. If none,
  // we leave band_id null and just use the customer-attribution band-style
  // booking. The flow still tests Iszac priority + admin alerts.
  const { data: anyBand } = await supabase
    .from('bands')
    .select('id, display_name')
    .limit(1)
    .maybeSingle();
  const testBandId = (anyBand as { id: string; display_name: string } | null)?.id ?? null;
  const testBandName =
    (anyBand as { id: string; display_name: string } | null)?.display_name ?? 'Test Band';

  // Case 1: Band 4hr session, requested Iszac
  {
    const start = baseStart;
    const end = addHours(start, 4);
    const priority = calculatePriorityExpiry(start.toISOString());
    const reschedule = calculateRescheduleDeadline(start.toISOString());
    const total = 60000; // $600
    const deposit = 30000;

    const { data: row, error } = await supabase
      .from('bookings')
      .insert({
        customer_name: '[TEST] Band 4hr Booker',
        customer_email: 'test-band-4hr@sweetdreams.test',
        customer_phone: '+12605551234',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration: 4,
        room: 'studio_a',
        engineer_name: null,
        requested_engineer: ISZAC_NAME,
        total_amount: total,
        deposit_amount: deposit,
        remainder_amount: total - deposit,
        actual_deposit_paid: deposit,
        night_fees_amount: 0,
        same_day_fee: false,
        same_day_fee_amount: 0,
        guest_count: 4,
        guest_fee_amount: 0,
        stripe_customer_id: 'cus_USICjYpdCnkBnG',
        stripe_checkout_session_id: `TEST-SESSION-${randomUUID()}`,
        stripe_payment_intent_id: `TEST-PI-${randomUUID()}`,
        status: 'confirmed',
        priority_expires_at: priority,
        reschedule_deadline: reschedule,
        admin_notes: '[TEST DATA — DELETE BEFORE LAUNCH] 4hr band session, Iszac requested.',
        band_id: testBandId,
        setup_minutes_before: 60,
      })
      .select('id')
      .single();

    if (error || !row) {
      console.error('  [band-4hr] insert failed:', error);
    } else {
      console.log(`  ✓ band 4hr booking → ${row.id}`);
      await sendBookingConfirmation('test-band-4hr@sweetdreams.test', {
        customerName: '[TEST] Band 4hr Booker',
        date: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: 4,
        room: 'studio_a',
        total,
        deposit,
        bookingId: row.id,
      });
      await sendAdminBookingAlert({
        id: row.id,
        customerName: `[TEST] ${testBandName} (4hr)`,
        customerEmail: 'test-band-4hr@sweetdreams.test',
        date: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: 4,
        room: 'studio_a',
        total,
      });
      await sendEngineerPriorityAlert(ISZAC_EMAIL, {
        id: row.id,
        customerName: `[TEST] ${testBandName}`,
        date: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: 4,
        room: 'studio_a',
        priorityHours: getPriorityHoursLabel(priority),
      });
      console.log('    ✉ buyer + admin + Iszac priority emails sent');
    }
  }

  // Case 2: Band 8hr session + Sweet Spot 8hr addon, requested Iszac
  {
    const start = addDays(baseStart, 1);
    const baseDuration = 8;
    const sweetSpotExtra = 2; // 8hr addon adds 2 filming hours
    const finalDuration = baseDuration + sweetSpotExtra;
    const end = addHours(start, finalDuration);
    const priority = calculatePriorityExpiry(start.toISOString());
    const reschedule = calculateRescheduleDeadline(start.toISOString());
    const total = 100000 + 200000; // $1000 base + $2000 Sweet Spot 8hr addon
    const deposit = 50000 + 100000;

    const sweetSpotAddon = {
      kind: '8hr-addon',
      price_cents: 200000,
      extra_filming_hours: 2,
    };

    const { data: row, error } = await supabase
      .from('bookings')
      .insert({
        customer_name: '[TEST] Band 8hr + Sweet Spot',
        customer_email: 'test-band-8hr@sweetdreams.test',
        customer_phone: '+12605551234',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration: finalDuration,
        room: 'studio_a',
        engineer_name: null,
        requested_engineer: ISZAC_NAME,
        total_amount: total,
        deposit_amount: deposit,
        remainder_amount: total - deposit,
        actual_deposit_paid: deposit,
        night_fees_amount: 0,
        same_day_fee: false,
        same_day_fee_amount: 0,
        guest_count: 5,
        guest_fee_amount: 0,
        stripe_customer_id: 'cus_USICLrlnWZoW9Q',
        stripe_checkout_session_id: `TEST-SESSION-${randomUUID()}`,
        stripe_payment_intent_id: `TEST-PI-${randomUUID()}`,
        status: 'confirmed',
        priority_expires_at: priority,
        reschedule_deadline: reschedule,
        admin_notes:
          '[TEST DATA — DELETE BEFORE LAUNCH] 8hr band + Sweet Spot 8hr filming addon. Iszac requested.',
        band_id: testBandId,
        setup_minutes_before: 60,
        sweet_spot_addon: sweetSpotAddon,
      })
      .select('id')
      .single();

    if (error || !row) {
      console.error('  [band-8hr] insert failed:', error);
    } else {
      console.log(`  ✓ band 8hr + Sweet Spot booking → ${row.id}`);
      await sendBookingConfirmation('test-band-8hr@sweetdreams.test', {
        customerName: '[TEST] Band 8hr + Sweet Spot',
        date: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: finalDuration,
        room: 'studio_a',
        total,
        deposit,
        bookingId: row.id,
      });
      await sendAdminBookingAlert({
        id: row.id,
        customerName: `[TEST] ${testBandName} (8hr + Sweet Spot)`,
        customerEmail: 'test-band-8hr@sweetdreams.test',
        date: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: finalDuration,
        room: 'studio_a',
        total,
      });
      await sendEngineerPriorityAlert(ISZAC_EMAIL, {
        id: row.id,
        customerName: `[TEST] ${testBandName}`,
        date: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: finalDuration,
        room: 'studio_a',
        priorityHours: getPriorityHoursLabel(priority),
      });
      console.log('    ✉ buyer + admin + Iszac priority emails sent');
    }
  }

  // Case 3: Band 24hr (3-day block) + Sweet Spot 3-day addon on day 0
  // Mirrors the webhook's fan-out behavior — 3 rows linked by booking_group_id
  {
    const day0Start = addDays(baseStart, 3);
    const groupId = randomUUID();
    const totalAcross = 300000 + 100000; // $3000 base (3×$1000) + $1000 Sweet Spot 3-day addon
    const depositAcross = 150000 + 50000;
    const perDayTotal = Math.round(totalAcross / 3);
    const perDayRemainder = Math.round((totalAcross - depositAcross) / 3);

    const filmingDayIndex = 0;
    const sweetSpotAddon = {
      kind: '3day-addon',
      filmingDayIndex,
      price_cents: 100000,
      extra_filming_hours: 2,
    };

    const stripeCustomerId = 'cus_USIC0jCKng0xQ7';
    const stripeSession = `TEST-SESSION-${randomUUID()}`;
    const stripePI = `TEST-PI-${randomUUID()}`;

    let day0BookingId: string | null = null;

    for (let i = 0; i < 3; i++) {
      const dayStart = addDays(day0Start, i);
      const isFilmingDay = i === filmingDayIndex;
      const dayDuration = isFilmingDay ? 8 + sweetSpotAddon.extra_filming_hours : 8;
      const dayEnd = addHours(dayStart, dayDuration);
      const priority = calculatePriorityExpiry(dayStart.toISOString());
      const reschedule = calculateRescheduleDeadline(dayStart.toISOString());

      const { data: row, error } = await supabase
        .from('bookings')
        .insert({
          customer_name: '[TEST] Band 24hr 3-Day',
          customer_email: 'test-band-24hr@sweetdreams.test',
          customer_phone: '+12605551234',
          start_time: dayStart.toISOString(),
          end_time: dayEnd.toISOString(),
          duration: dayDuration,
          room: 'studio_a',
          engineer_name: null,
          requested_engineer: ISZAC_NAME,
          total_amount: perDayTotal,
          deposit_amount: i === 0 ? depositAcross : 0,
          remainder_amount: i === 0 ? totalAcross - depositAcross - 2 * perDayRemainder : perDayRemainder,
          actual_deposit_paid: i === 0 ? depositAcross : 0,
          night_fees_amount: 0,
          same_day_fee: false,
          same_day_fee_amount: 0,
          guest_count: 6,
          guest_fee_amount: 0,
          stripe_customer_id: stripeCustomerId,
          stripe_checkout_session_id: stripeSession,
          stripe_payment_intent_id: i === 0 ? stripePI : null,
          status: 'confirmed',
          priority_expires_at: priority,
          reschedule_deadline: reschedule,
          admin_notes:
            i === 0
              ? '[TEST DATA — DELETE BEFORE LAUNCH] 3-day band block — Day 1 of 3 + Sweet Spot filming. Iszac requested. Admin must call buyer to confirm logistics.'
              : `[TEST DATA — DELETE BEFORE LAUNCH] 3-day band block — Day ${i + 1} of 3.`,
          band_id: testBandId,
          setup_minutes_before: i === 0 ? 60 : 0,
          booking_group_id: groupId,
          sweet_spot_addon: isFilmingDay ? sweetSpotAddon : null,
        })
        .select('id')
        .single();

      if (error || !row) {
        console.error(`  [band-24hr day ${i + 1}] insert failed:`, error);
      } else {
        if (i === 0) day0BookingId = row.id;
        console.log(`  ✓ band 24hr block — Day ${i + 1}/3 → ${row.id}`);
      }
    }

    // Send the engineer priority alert ONCE for day 0 (mirror of webhook
    // behavior — engineer alerts hang off the canonical day-1 row).
    if (day0BookingId) {
      await sendBookingConfirmation('test-band-24hr@sweetdreams.test', {
        customerName: '[TEST] Band 24hr 3-Day',
        date: day0Start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: day0Start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: 24,
        room: 'studio_a',
        total: totalAcross,
        deposit: depositAcross,
        bookingId: day0BookingId,
      });
      await sendAdminBookingAlert({
        id: day0BookingId,
        customerName: `[TEST] ${testBandName} (24hr 3-Day + Sweet Spot)`,
        customerEmail: 'test-band-24hr@sweetdreams.test',
        date: day0Start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: day0Start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: 24,
        room: 'studio_a',
        total: totalAcross,
      });
      const day0Priority = calculatePriorityExpiry(day0Start.toISOString());
      await sendEngineerPriorityAlert(ISZAC_EMAIL, {
        id: day0BookingId,
        customerName: `[TEST] ${testBandName} (3-Day)`,
        date: day0Start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
        startTime: day0Start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
        duration: 24,
        room: 'studio_a',
        priorityHours: getPriorityHoursLabel(day0Priority),
      });
      console.log('    ✉ buyer + admin + Iszac priority emails sent (day 0 anchor)');
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Seeding test bookings against', SUPABASE_URL);
  console.log('Iszac email target:', ISZAC_EMAIL);

  const buyerUserId = await pickAdminUserId();
  console.log('Using buyer user_id:', buyerUserId);

  await seedMediaBookings(buyerUserId);
  await seedBandBookings();

  console.log('\n─── DONE ────────────────────────────────────────────────');
  console.log('Cleanup commands:');
  console.log("  DELETE FROM media_bookings WHERE is_test = TRUE;");
  console.log("  DELETE FROM bookings WHERE customer_email LIKE '%@sweetdreams.test';");
  console.log('');
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
