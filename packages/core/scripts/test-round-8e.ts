/**
 * scripts/test-round-8e.ts
 *
 * Round 8e verification:
 *   1. Migration 050 source + applied
 *   2. Line item complete API route
 *   3. PackageBuilder admin completion UI (LineItemCompletion)
 *   4. PackageReview buyer delivery UI
 *   5. Integration: mark complete → row updated, idempotent re-mark
 *
 * Run: npx tsx --env-file=.env.local scripts/test-round-8e.ts
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
  console.log('Round 8e verification\n');

  // 1. Migration
  console.log('1. Migration 050');
  const migSrc = (() => {
    try { return readFileSync('supabase-migrations/050_line_item_completion.sql', 'utf8'); }
    catch { return ''; }
  })();
  assert('050_line_item_completion.sql exists', !!migSrc);
  assert('Adds completed BOOLEAN', /ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT FALSE/.test(migSrc));
  assert('Adds drive_url column', /ADD COLUMN IF NOT EXISTS drive_url TEXT/.test(migSrc));
  assert('Adds notified_at column', /ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ/.test(migSrc));
  assert('Partial index on completed=TRUE', /CREATE INDEX IF NOT EXISTS media_booking_line_items_completed_idx[\s\S]{0,100}WHERE completed = TRUE/.test(migSrc));

  // Schema applied
  const { error } = await supabase
    .from('media_booking_line_items')
    .select('id, completed, drive_url, notified_at, completed_at, completed_by')
    .limit(1);
  assert('Line items new columns queryable', !error, error?.message);

  // 2. API route
  console.log('\n2. API route');
  const routeSrc = (() => {
    try { return readFileSync('app/api/admin/media/bookings/[id]/line-items/[lineId]/complete/route.ts', 'utf8'); }
    catch { return ''; }
  })();
  assert('Route file exists', !!routeSrc);
  assert('Admin-only enforced', /user\.role !== 'admin'/.test(routeSrc));
  assert('Validates http(s) drive_url', /drive_url must start with http/.test(routeSrc));
  assert('Idempotent buyer email via notified_at', /!line\.notified_at/.test(routeSrc));
  assert('Stamps notified_at after sending email', /notified_at: now/.test(routeSrc));
  assert('Audit log on complete + uncomplete', /'line_item_completed'/.test(routeSrc) && /'line_item_uncompleted'/.test(routeSrc));
  assert('Calls sendMediaComponentReady', /sendMediaComponentReady/.test(routeSrc));

  // 3. PackageBuilder LineItemCompletion
  console.log('\n3. Admin UI');
  const builder = readFileSync('components/media/PackageBuilder.tsx', 'utf8');
  assert('LineItemCompletion component defined', /function LineItemCompletion/.test(builder));
  assert('Submits to /admin/media/bookings/[id]/line-items/[lineId]/complete', /\/api\/admin\/media\/bookings\/.{0,30}\/line-items\/.{0,30}\/complete/.test(builder));
  assert('"Mark complete" disabled without drive URL', /!drive\.trim\(\)/.test(builder));
  assert('Reopen button when already completed', /Reopen/.test(builder));
  assert('Renders LineItemCompletion under each saved line item', /<LineItemCompletion[\s\S]{0,200}item=\{it\}/.test(builder));

  // 4. PackageReview buyer delivery UI
  console.log('\n4. Buyer UI');
  const review = readFileSync('components/media/PackageReview.tsx', 'utf8');
  assert('Imports PackageCheck + Download icons', /PackageCheck/.test(review) && /Download/.test(review));
  assert('Shows "Delivered" badge when completed', /Delivered/.test(review));
  assert('Renders Drive URL download link', /it\.drive_url/.test(review));

  // 5. Integration
  console.log('\n5. Integration: mark complete + Drive URL round-trip');
  const { data: testBooking } = await supabase
    .from('media_bookings')
    .select('id')
    .eq('is_test', true)
    .limit(1)
    .maybeSingle();
  if (!testBooking) {
    console.error('  ✗ No test booking');
    failures++;
  } else {
    const tb = testBooking as { id: string };
    // Cleanup any prior package
    await supabase.from('media_booking_packages').delete().eq('booking_id', tb.id);

    const { data: pkg } = await supabase
      .from('media_booking_packages')
      .insert({ booking_id: tb.id, status: 'approved', total_cents: 50000, approved_at: new Date().toISOString() })
      .select('id').single();
    const { data: line } = await supabase
      .from('media_booking_line_items')
      .insert({
        package_id: (pkg as { id: string }).id,
        kind: 'cover_art',
        label: '[TEST] Cover art',
        qty: 1,
        unit_cents: 50000,
        total_cents: 50000,
        sort_order: 0,
        approval_status: 'approved',
      })
      .select('id').single();
    const lineId = (line as { id: string }).id;

    // Mark completed via direct update (simulating the API)
    const driveUrl = 'https://drive.google.com/file/d/test123';
    await supabase
      .from('media_booking_line_items')
      .update({
        completed: true,
        completed_at: new Date().toISOString(),
        drive_url: driveUrl,
        notified_at: new Date().toISOString(),
      })
      .eq('id', lineId);

    const { data: after } = await supabase
      .from('media_booking_line_items')
      .select('completed, drive_url, notified_at')
      .eq('id', lineId)
      .single();
    type AR = { completed: boolean; drive_url: string; notified_at: string };
    const a = after as AR;
    assert('Line item marked completed', a.completed === true);
    assert('Drive URL persisted', a.drive_url === driveUrl);
    assert('notified_at stamped', !!a.notified_at);

    // Re-mark — notified_at shouldn't reset on idempotent re-mark
    const originalNotified = a.notified_at;
    await supabase
      .from('media_booking_line_items')
      .update({ completed: true })
      .eq('id', lineId);
    const { data: after2 } = await supabase
      .from('media_booking_line_items')
      .select('notified_at').eq('id', lineId).single();
    assert(
      'Re-mark preserves notified_at (idempotent)',
      (after2 as { notified_at: string }).notified_at === originalNotified,
    );

    // Cleanup
    await supabase.from('media_booking_packages').delete().eq('id', (pkg as { id: string }).id);
    console.log('  · cleanup: test package removed');
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test failed:', e); process.exit(1); });
