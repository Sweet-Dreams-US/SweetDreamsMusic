/**
 * scripts/test-round-8d.ts
 *
 * Round 8d verification:
 *   1. Migration 049 source + applied to DB
 *   2. API routes: propose, approve
 *   3. SessionScheduler component
 *   4. Wiring into PackageBuilder + PackageReview
 *   5. Integration: propose → counter → approve cycle via service client
 *
 * Run: npx tsx --env-file=.env.local scripts/test-round-8d.ts
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

let failures = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log('Round 8d verification\n');

  // 1. Migration
  console.log('1. Migration 049');
  const migSrc = (() => {
    try { return readFileSync('supabase-migrations/049_session_proposal_cycle.sql', 'utf8'); }
    catch { return ''; }
  })();
  assert('049_session_proposal_cycle.sql exists', !!migSrc);
  assert('Adds line_item_id column', /ADD COLUMN IF NOT EXISTS line_item_id UUID/.test(migSrc));
  assert('Adds proposed_by column', /ADD COLUMN IF NOT EXISTS proposed_by TEXT/.test(migSrc));
  assert('Adds supersedes_id self-FK', /ADD COLUMN IF NOT EXISTS supersedes_id UUID/.test(migSrc));
  assert('Status CHECK includes proposed + superseded', /'proposed'.*'superseded'/.test(migSrc));
  assert('session_kind CHECK includes planning_call', /planning_call/.test(migSrc));
  assert('engineer_id is now nullable', /ALTER COLUMN engineer_id DROP NOT NULL/.test(migSrc));

  // Schema applied
  const { error: q } = await supabase
    .from('media_session_bookings')
    .select('id, line_item_id, proposed_by, supersedes_id')
    .limit(1);
  assert('media_session_bookings new columns queryable', !q, q?.message);

  // 2. API routes
  console.log('\n2. API routes');
  const proposeRoute = (() => {
    try { return readFileSync('app/api/media/bookings/[id]/line-items/[lineId]/sessions/route.ts', 'utf8'); }
    catch { return ''; }
  })();
  assert('Sessions POST/GET route exists', !!proposeRoute);
  assert('Validates starts_at < ends_at', /endMs <= startMs/.test(proposeRoute));
  assert('Validates location enum', /VALID_LOCATIONS/.test(proposeRoute));
  assert('Validates external_location_text required for external', /external_location_text required/.test(proposeRoute));
  assert('Marks superseded row when supersedes_id passed', /'superseded'/.test(proposeRoute));
  assert('Posts system message for digest', /author_role:\s*'system'/.test(proposeRoute));
  assert('Engineer cannot propose dates', /Engineers can use the chat to coordinate/.test(proposeRoute));

  const approveRoute = (() => {
    try { return readFileSync('app/api/media/bookings/[id]/sessions/[sessionId]/approve/route.ts', 'utf8'); }
    catch { return ''; }
  })();
  assert('Approve route exists', !!approveRoute);
  assert('Approve flips status proposed → scheduled', /status:\s*'scheduled'/.test(approveRoute));
  assert('Same-side cannot approve own proposal', /You proposed this date/.test(approveRoute));
  assert('Engineer assignment required for non-call sessions', /Engineer required to schedule/.test(approveRoute));
  assert('Audit log entry on approve', /'session_approved'/.test(approveRoute));

  // 3. Component
  console.log('\n3. SessionScheduler component');
  const compSrc = (() => {
    try { return readFileSync('components/media/SessionScheduler.tsx', 'utf8'); }
    catch { return ''; }
  })();
  assert('Component exists', !!compSrc);
  assert("'use client'", /'use client'/.test(compSrc));
  assert('Default export', /export default function SessionScheduler/.test(compSrc));
  assert('Has KIND_OPTIONS', /KIND_OPTIONS/.test(compSrc));
  assert('Counter button creates new proposal with supersedes_id', /supersedesId/.test(compSrc));
  assert('Engineer dropdown for admin approval', /Pick engineer/.test(compSrc));
  assert('Other-side proposal detection', /otherSideProposed/.test(compSrc));

  // 4. Wiring
  console.log('\n4. Wiring');
  const review = readFileSync('components/media/PackageReview.tsx', 'utf8');
  assert('PackageReview imports SessionScheduler', /import SessionScheduler from '\.\/SessionScheduler'/.test(review));
  assert('PackageReview renders SessionScheduler per line item', /<SessionScheduler[\s\S]{0,200}lineId=\{it\.id\}/.test(review));
  assert('PackageReview maps line kind to default session kind', /defaultSessionKindFor/.test(review));

  const builder = readFileSync('components/media/PackageBuilder.tsx', 'utf8');
  assert('PackageBuilder imports SessionScheduler', /import SessionScheduler from '\.\/SessionScheduler'/.test(builder));
  assert('PackageBuilder gates on saved item id', /it\.id\s*&&/.test(builder));
  assert('PackageBuilder maps line kind to default session kind', /defaultSessionKindFor/.test(builder));

  // 5. Integration
  console.log('\n5. Integration round-trip');
  const { data: testBooking } = await supabase
    .from('media_bookings')
    .select('id, user_id')
    .eq('is_test', true)
    .limit(1)
    .maybeSingle();
  if (!testBooking) {
    console.error('  ✗ No test booking — re-run scripts/seed-test-bookings.ts');
    failures++;
  } else {
    const tb = testBooking as { id: string; user_id: string };
    // Cleanup any prior package
    await supabase.from('media_booking_packages').delete().eq('booking_id', tb.id);

    // Build a minimal package + line item
    const { data: pkg } = await supabase
      .from('media_booking_packages')
      .insert({ booking_id: tb.id, status: 'sent', total_cents: 100000, proposed_at: new Date().toISOString() })
      .select('id').single();
    const pkgId = (pkg as { id: string }).id;
    const { data: lineItem } = await supabase
      .from('media_booking_line_items')
      .insert({
        package_id: pkgId, kind: 'music_video', label: '[TEST] MV — proposal cycle',
        qty: 1, unit_cents: 100000, total_cents: 100000, sort_order: 0,
      })
      .select('id').single();
    const lineId = (lineItem as { id: string }).id;

    // Buyer proposes a date
    const { data: proposal } = await supabase
      .from('media_session_bookings')
      .insert({
        parent_booking_id: tb.id,
        line_item_id: lineId,
        starts_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        ends_at: new Date(Date.now() + 7 * 86400_000 + 4 * 3600_000).toISOString(),
        location: 'external',
        external_location_text: 'Riverside warehouse, Fort Wayne',
        session_kind: 'filming_external',
        status: 'proposed',
        proposed_by: 'buyer',
        proposed_at: new Date().toISOString(),
      })
      .select('id, status, proposed_by').single();
    type Sess = { id: string; status: string; proposed_by: string };
    const p1 = proposal as Sess;
    assert('Buyer proposal inserted with status=proposed', p1?.status === 'proposed');
    assert('proposed_by=buyer', p1?.proposed_by === 'buyer');

    // Admin counter-proposes (creates a new row referencing the original)
    const { data: counter } = await supabase
      .from('media_session_bookings')
      .insert({
        parent_booking_id: tb.id,
        line_item_id: lineId,
        starts_at: new Date(Date.now() + 8 * 86400_000).toISOString(),
        ends_at: new Date(Date.now() + 8 * 86400_000 + 4 * 3600_000).toISOString(),
        location: 'external',
        external_location_text: 'Different warehouse',
        session_kind: 'filming_external',
        status: 'proposed',
        proposed_by: 'admin',
        proposed_at: new Date().toISOString(),
        supersedes_id: p1.id,
      })
      .select('id').single();
    const counterId = (counter as { id: string }).id;

    // Mark original superseded (the API does this automatically; here we
    // simulate it to verify the constraint accepts the transition).
    await supabase
      .from('media_session_bookings')
      .update({ status: 'superseded' })
      .eq('id', p1.id);

    const { data: prevRow } = await supabase
      .from('media_session_bookings')
      .select('status').eq('id', p1.id).single();
    assert('Original proposal flipped to superseded', (prevRow as { status: string })?.status === 'superseded');

    // Buyer approves the counter (engineer not required for filming_external?
    // It IS required — but we'll set it manually for the smoke test).
    const { data: engineer } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();
    const engineerUid = (engineer as { user_id: string } | null)?.user_id;

    const { error: approveErr } = await supabase
      .from('media_session_bookings')
      .update({
        status: 'scheduled',
        approved_at: new Date().toISOString(),
        approved_by: tb.user_id,
        engineer_id: engineerUid,
      })
      .eq('id', counterId);
    assert('Counter approval succeeded', !approveErr, approveErr?.message);

    const { data: finalRow } = await supabase
      .from('media_session_bookings')
      .select('status, engineer_id').eq('id', counterId).single();
    type FR = { status: string; engineer_id: string | null };
    assert('Counter is now scheduled', (finalRow as FR)?.status === 'scheduled');
    assert('Counter has engineer assigned', !!(finalRow as FR)?.engineer_id);

    // Cleanup
    await supabase.from('media_booking_packages').delete().eq('id', pkgId);
    console.log('  · cleanup: test package + sessions removed');
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test failed:', e); process.exit(1); });
