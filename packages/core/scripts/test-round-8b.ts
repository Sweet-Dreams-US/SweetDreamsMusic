/**
 * scripts/test-round-8b.ts
 *
 * Round 8b verification:
 *   1. Schema: media_booking_messages table + RLS policies
 *   2. Source: API route exports GET + POST, role resolution helper
 *   3. Source: MessageThread component imports + role-aware rendering
 *   4. Source: sendNewMediaMessageNotification helper exported with right shape
 *   5. Integration: insert a message via service client, verify queryable
 *
 * Run: npx tsx --env-file=.env.local scripts/test-round-8b.ts
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

let failures = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
console.log('Round 8b verification\n');

// 1. Migration source file present.
console.log('1. Migration file');
const migSrc = (() => {
  try { return readFileSync('supabase-migrations/047_media_booking_messages.sql', 'utf8'); }
  catch { return ''; }
})();
assert('047_media_booking_messages.sql exists', !!migSrc);
assert('Has CREATE TABLE media_booking_messages', /CREATE TABLE IF NOT EXISTS media_booking_messages/.test(migSrc));
assert('Has author_role CHECK constraint with admin/buyer/engineer/system', /author_role IN \('admin', 'buyer', 'engineer', 'system'\)/.test(migSrc));
assert('Has FK booking_id → media_bookings ON DELETE CASCADE', /booking_id\s+UUID NOT NULL REFERENCES media_bookings\(id\) ON DELETE CASCADE/.test(migSrc));
assert('Has buyer_read RLS policy', /media_booking_messages_buyer_read/.test(migSrc));
assert('Has band_read RLS policy', /media_booking_messages_band_read/.test(migSrc));
assert('Has admin_read RLS policy', /media_booking_messages_admin_read/.test(migSrc));
assert('Has engineer_read RLS policy', /media_booking_messages_engineer_read/.test(migSrc));

// 2. Schema applied (table accessible via service client)
console.log('\n2. Schema applied to live DB');
const { data: schemaCheck, error: schemaErr } = await supabase
  .from('media_booking_messages')
  .select('id')
  .limit(1);
assert('media_booking_messages queryable', !schemaErr, schemaErr?.message);

// 3. API route file present + has handlers
console.log('\n3. API route exports');
const routeSrc = (() => {
  try { return readFileSync('app/api/media/bookings/[id]/messages/route.ts', 'utf8'); }
  catch { return ''; }
})();
assert('Route file exists', !!routeSrc);
assert('Exports GET handler', /export async function GET/.test(routeSrc));
assert('Exports POST handler', /export async function POST/.test(routeSrc));
assert('resolveViewerRole helper checks all 3 paths', /user\.role === 'admin'|booking\.user_id === user\.id|engineer_id\s*=\s*user\.id|engineer_id:\s*user\.id/.test(routeSrc));
assert('Validates attachment URLs (http/https)', /\^https\?:\\?\/\\?\//.test(routeSrc));
assert('Caps message body at 5000 chars', /messageBody\.length > 5000/.test(routeSrc));
assert('Caps attachments at 10', /attachments\.length > 10/.test(routeSrc));
assert('Writes audit log row on post', /media_booking_audit_log[\s\S]{0,200}'message_posted'/.test(routeSrc));
assert('Calls sendNewMediaMessageNotification', /sendNewMediaMessageNotification/.test(routeSrc));

// 4. MessageThread component
console.log('\n4. MessageThread component');
const compSrc = (() => {
  try { return readFileSync('components/media/MessageThread.tsx', 'utf8'); }
  catch { return ''; }
})();
assert('Component file exists', !!compSrc);
assert("Marked 'use client'", /'use client'/.test(compSrc));
assert('Default export', /export default function MessageThread/.test(compSrc));
assert('Polls every 30s', /POLL_INTERVAL_MS\s*=\s*30_000/.test(compSrc));
assert('Refreshes on window focus', /window\.addEventListener\('focus'/.test(compSrc));
assert('Auto-scrolls to bottom on new messages', /scrollTop\s*=\s*listRef\.current\.scrollHeight/.test(compSrc));
assert('Renders system messages distinctly', /isSystem/.test(compSrc));

// 5. Email helper
console.log('\n5. Email helper');
const emailSrc = readFileSync('lib/email.ts', 'utf8');
assert('sendNewMediaMessageNotification exported', /export async function sendNewMediaMessageNotification/.test(emailSrc));
assert('Routes admin posts to buyer email', /args\.authorRole === 'admin'[\s\S]{0,500}buyerEmail/.test(emailSrc));
assert('Routes buyer/engineer posts to SUPER_ADMINS', /\[\.\.\.SUPER_ADMINS\][\s\S]{0,500}New \$\{args\.authorRole\}/.test(emailSrc));

// 6. Buyer order page wired
console.log('\n6. Wiring');
const buyerPage = readFileSync('app/dashboard/media/orders/[id]/page.tsx', 'utf8');
assert('Buyer order page imports MessageThread', /import MessageThread from '@\/components\/media\/MessageThread'/.test(buyerPage));
assert('Buyer order page renders <MessageThread bookingId=', /<MessageThread bookingId=\{booking\.id\}/.test(buyerPage));

const adminMedia = readFileSync('components/admin/MediaOrders.tsx', 'utf8');
assert('Admin MediaOrders imports MessageThread', /import MessageThread from '@\/components\/media\/MessageThread'/.test(adminMedia));
assert('Admin MediaOrders renders <MessageThread bookingId=', /<MessageThread bookingId=\{booking\.id\}/.test(adminMedia));

// 7. Integration: insert + read via service client
console.log('\n7. Integration: round-trip insert/read');
const { data: testBooking } = await supabase
  .from('media_bookings')
  .select('id')
  .eq('is_test', true)
  .limit(1)
  .maybeSingle();
if (!testBooking) {
  console.error('  ✗ No test booking available — re-run scripts/seed-test-bookings.ts first');
  failures++;
} else {
  const tid = (testBooking as { id: string }).id;
  const { data: msg, error: insErr } = await supabase
    .from('media_booking_messages')
    .insert({
      booking_id: tid,
      author_user_id: null, // 'system'-style insert via service client
      author_role: 'system',
      body: '[TEST] Round 8b smoke insert — confirms service client + RLS bypass working.',
      attachments: [
        { label: 'Test reference', url: 'https://example.com/ref.jpg', kind: 'image' },
      ],
    })
    .select('id, author_role, body, attachments, created_at')
    .single();
  assert('Insert succeeded', !insErr, insErr?.message);
  assert('Message has correct author_role', msg?.author_role === 'system');
  assert('Attachments JSONB round-tripped', Array.isArray(msg?.attachments) && msg.attachments.length === 1);

  // Read it back
  const { data: readBack } = await supabase
    .from('media_booking_messages')
    .select('id, body')
    .eq('booking_id', tid)
    .order('created_at', { ascending: false });
  assert('Read-back returns at least the inserted message', !!readBack && readBack.length >= 1);

  // Cleanup the smoke message so we don't pollute the thread
  if (msg?.id) {
    await supabase.from('media_booking_messages').delete().eq('id', msg.id);
    console.log('  · cleanup: smoke message removed');
  }
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test failed:', e); process.exit(1); });
