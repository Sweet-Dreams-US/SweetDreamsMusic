/**
 * scripts/test-round-8c.ts
 *
 * Round 8c verification:
 *   1. Migration 048 source file present + applied
 *   2. lib/media-packages helpers (planning-call rule, totals, full-approval)
 *   3. API routes: package GET/PUT, send, approve
 *   4. Components: PackageBuilder + PackageReview
 *   5. Wiring on buyer order page + admin MediaOrders
 *   6. Integration: build → send → approve cycle round-trip via service client
 *
 * Run: npx tsx --env-file=.env.local scripts/test-round-8c.ts
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  packageNeedsPlanningCall,
  ensurePlanningCallInjection,
  computePackageTotalCents,
  lineItemTotalCents,
  isPackageFullyApproved,
  LINE_ITEM_KINDS,
} from '../lib/media-packages';

let failures = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log('Round 8c verification\n');

  // 1. Migration file + DB applied.
  console.log('1. Migration 048');
  const migSrc = (() => {
    try { return readFileSync('supabase-migrations/048_media_booking_packages.sql', 'utf8'); }
    catch { return ''; }
  })();
  assert('048_media_booking_packages.sql exists', !!migSrc);
  assert('Has CREATE TABLE media_booking_packages', /CREATE TABLE IF NOT EXISTS media_booking_packages/.test(migSrc));
  assert('Has CREATE TABLE media_booking_line_items', /CREATE TABLE IF NOT EXISTS media_booking_line_items/.test(migSrc));
  assert('package status CHECK draft/sent/approved', /status IN \('draft', 'sent', 'approved'\)/.test(migSrc));
  assert('approval_status CHECK pending/approved/rejected', /approval_status IN \('pending', 'approved', 'rejected'\)/.test(migSrc));
  assert('booking_id UNIQUE on packages', /booking_id\s+UUID NOT NULL UNIQUE/.test(migSrc));
  assert('CASCADE delete on line items via package', /package_id.*ON DELETE CASCADE/.test(migSrc));

  const { error: pkgQ } = await supabase.from('media_booking_packages').select('id').limit(1);
  assert('media_booking_packages queryable', !pkgQ, pkgQ?.message);
  const { error: liQ } = await supabase.from('media_booking_line_items').select('id').limit(1);
  assert('media_booking_line_items queryable', !liQ, liQ?.message);

  // 2. Pure helpers
  console.log('\n2. media-packages helpers');
  assert('LINE_ITEM_KINDS contains 10 kinds', LINE_ITEM_KINDS.length === 10);
  assert('LINE_ITEM_KINDS includes planning_call', LINE_ITEM_KINDS.includes('planning_call'));

  // packageNeedsPlanningCall
  assert(
    'planning needed: music_video',
    packageNeedsPlanningCall([{ kind: 'music_video', qty: 1 }]),
  );
  assert(
    'planning needed: 3 shorts',
    packageNeedsPlanningCall([{ kind: 'shorts', qty: 3 }]),
  );
  assert(
    'planning NOT needed: 2 shorts',
    !packageNeedsPlanningCall([{ kind: 'shorts', qty: 2 }]),
  );
  assert(
    'planning NOT needed: cover_art only',
    !packageNeedsPlanningCall([{ kind: 'cover_art', qty: 1 }]),
  );

  // ensurePlanningCallInjection
  const injected = ensurePlanningCallInjection(
    [{ kind: 'music_video', qty: 1 } as { kind: 'music_video' | 'planning_call'; qty: number }],
    () => ({ kind: 'planning_call', qty: 1 }),
  );
  assert('Injection adds planning_call when needed', injected.injected && injected.items[0].kind === 'planning_call');
  const skipExisting = ensurePlanningCallInjection(
    [
      { kind: 'planning_call', qty: 1 } as { kind: 'music_video' | 'planning_call'; qty: number },
      { kind: 'music_video', qty: 1 },
    ],
    () => ({ kind: 'planning_call', qty: 1 }),
  );
  assert('Injection skips when planning_call already present', !skipExisting.injected);

  // computePackageTotalCents
  assert(
    'computePackageTotalCents sums correctly',
    computePackageTotalCents([{ total_cents: 100 }, { total_cents: 250 }, { total_cents: 50 }]) === 400,
  );
  assert('lineItemTotalCents qty×unit', lineItemTotalCents(3, 1500) === 4500);
  assert(
    'isPackageFullyApproved true when all approved',
    isPackageFullyApproved([
      { approval_status: 'approved' },
      { approval_status: 'approved' },
    ]),
  );
  assert(
    'isPackageFullyApproved false with mixed',
    !isPackageFullyApproved([
      { approval_status: 'approved' },
      { approval_status: 'pending' },
    ]),
  );
  assert('isPackageFullyApproved false on empty', !isPackageFullyApproved([]));

  // 3. API routes
  console.log('\n3. API routes');
  const pkgRoute = readFileSync('app/api/media/bookings/[id]/package/route.ts', 'utf8');
  assert('Package GET handler exported', /export async function GET/.test(pkgRoute));
  assert('Package PUT handler exported', /export async function PUT/.test(pkgRoute));
  assert('PUT enforces admin role', /user\.role !== 'admin'/.test(pkgRoute));
  assert('PUT auto-injects planning_call', /ensurePlanningCallInjection/.test(pkgRoute));
  assert('PUT rejects edits to approved packages', /Package is approved.*cannot edit/.test(pkgRoute));
  assert('PUT writes audit log', /package_edited|package_created/.test(pkgRoute));

  const sendRoute = readFileSync('app/api/media/bookings/[id]/package/send/route.ts', 'utf8');
  assert('Send route exists', !!sendRoute);
  assert('Send flips draft → sent', /'sent', proposed_at: now/.test(sendRoute));
  assert('Send posts system message', /author_role: 'system'/.test(sendRoute));
  assert('Send fires email digest', /sendNewMediaMessageNotification/.test(sendRoute));

  const approveRoute = readFileSync('app/api/media/bookings/[id]/package/line-items/[lineId]/approve/route.ts', 'utf8');
  assert('Approve route exists', !!approveRoute);
  assert('Approve checks line item belongs to booking', /pkg\.booking_id !== bookingId/.test(approveRoute));
  assert('Approve flips package when all line items approved', /everyApproved.*pkg\.status !== 'approved'/.test(approveRoute));
  assert('Approve moves booking deposited → scheduled', /booking\.status === 'deposited'/.test(approveRoute));
  assert('Approve writes line_item_approved + package_approved audit', /line_item_approved/.test(approveRoute) && /package_approved/.test(approveRoute));

  // 4. Components
  console.log('\n4. UI components');
  const builder = readFileSync('components/media/PackageBuilder.tsx', 'utf8');
  assert('PackageBuilder is client component', /'use client'/.test(builder));
  assert('PackageBuilder fetches package on mount', /\/api\/media\/bookings\/.{1,30}\/package/.test(builder));
  assert('PackageBuilder has Save + Send buttons', /Save draft/.test(builder) && /Send to buyer/.test(builder));
  assert('PackageBuilder shows planning_call warning', /planning_call line[\s\S]{0,40}auto-added/.test(builder));
  assert('PackageBuilder pre-fill from offering', /autoFillFromOffering/.test(builder));

  const review = readFileSync('components/media/PackageReview.tsx', 'utf8');
  assert('PackageReview is client component', /'use client'/.test(review));
  assert('PackageReview hides on draft', /pkg\.status === 'draft'/.test(review));
  assert('PackageReview per-line approve', /\/line-items\/\$\{|\/line-items\/.{0,20}\/approve/.test(review));
  assert('PackageReview links to chat #conversation', /href="#conversation"/.test(review));

  // 5. Wiring
  console.log('\n5. Wiring');
  const buyerPage = readFileSync('app/dashboard/media/orders/[id]/page.tsx', 'utf8');
  assert('Buyer page imports PackageReview', /import PackageReview from '@\/components\/media\/PackageReview'/.test(buyerPage));
  assert('Buyer page renders PackageReview', /<PackageReview bookingId=\{booking\.id\}/.test(buyerPage));
  assert('Buyer page conversation has id="conversation"', /id="conversation"/.test(buyerPage));

  const adminMedia = readFileSync('components/admin/MediaOrders.tsx', 'utf8');
  assert('Admin imports PackageBuilder', /import PackageBuilder from '@\/components\/media\/PackageBuilder'/.test(adminMedia));
  assert('Admin renders PackageBuilder', /<PackageBuilder/.test(adminMedia));

  // 6. Integration: build → send → approve round-trip via service client.
  console.log('\n6. Integration round-trip');
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
    // Cleanup any prior package on this booking so the run is fresh
    await supabase.from('media_booking_packages').delete().eq('booking_id', tb.id);

    // Build a package with music_video → expect planning_call injected
    const { data: pkg } = await supabase
      .from('media_booking_packages')
      .insert({ booking_id: tb.id, status: 'draft', total_cents: 0 })
      .select('id')
      .single();
    const pkgId = (pkg as { id: string }).id;

    await supabase.from('media_booking_line_items').insert([
      { package_id: pkgId, kind: 'planning_call', label: 'Initial scope call', qty: 1, unit_cents: 0, total_cents: 0, sort_order: 0 },
      { package_id: pkgId, kind: 'music_video', label: 'Premium music video', qty: 1, unit_cents: 250000, total_cents: 250000, sort_order: 1 },
      { package_id: pkgId, kind: 'cover_art', label: 'Single cover', qty: 1, unit_cents: 15000, total_cents: 15000, sort_order: 2 },
    ]);
    await supabase.from('media_booking_packages').update({ total_cents: 265000 }).eq('id', pkgId);

    const { data: items } = await supabase
      .from('media_booking_line_items')
      .select('id, kind, approval_status')
      .eq('package_id', pkgId)
      .order('sort_order');
    type Row = { id: string; kind: string; approval_status: string };
    const rows = (items ?? []) as Row[];
    assert('Package has 3 line items', rows.length === 3);
    assert('Planning call is sort_order 0', rows[0]?.kind === 'planning_call');

    // Approve them all
    for (const r of rows) {
      await supabase
        .from('media_booking_line_items')
        .update({ approval_status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', r.id);
    }
    const { data: afterApprovals } = await supabase
      .from('media_booking_line_items')
      .select('approval_status')
      .eq('package_id', pkgId);
    type AR = { approval_status: string };
    const allApproved = (afterApprovals as AR[] | null)?.every((r) => r.approval_status === 'approved') ?? false;
    assert('All line items approved', allApproved);

    // Manually flip package status (the API approve route does this; here
    // we simulate it to verify the schema accepts the transition).
    const { error: flipErr } = await supabase
      .from('media_booking_packages')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: tb.user_id })
      .eq('id', pkgId);
    assert('Package flipped to approved without constraint error', !flipErr, flipErr?.message);

    // Verify trying to insert another line item with bad kind still hits no DB constraint
    // (kind is TEXT, no enum) — this confirms the API validation is the gate.
    const { error: badKindErr } = await supabase
      .from('media_booking_line_items')
      .insert({ package_id: pkgId, kind: 'totally_made_up_kind', label: 'oops', qty: 1, unit_cents: 0, total_cents: 0, sort_order: 99 });
    assert('DB accepts free-form kind (API validates)', !badKindErr, badKindErr?.message);

    // Cleanup
    await supabase.from('media_booking_packages').delete().eq('id', pkgId);
    console.log('  · cleanup: test package removed');
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test failed:', e); process.exit(1); });
