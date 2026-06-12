/**
 * scripts/test-post-fix.ts
 *
 * Regression coverage for the 11 post-review fixes. Each block exercises
 * one of the issues the reviewers flagged.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-post-fix.ts
 */

import { readFileSync } from 'fs';
import { escapeHtml } from '../lib/email';

let failures = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
}

console.log('Post-fix regression\n');

// 1. escapeHtml escapes the dangerous chars + newline
console.log('1. escapeHtml');
assert('Escapes <', escapeHtml('<script>') === '&lt;script&gt;');
assert('Escapes >', escapeHtml('a > b') === 'a &gt; b');
assert('Escapes &', escapeHtml('Tom & Jerry') === 'Tom &amp; Jerry');
assert('Escapes "', escapeHtml('say "hi"') === 'say &quot;hi&quot;');
assert("Escapes '", escapeHtml("don't") === 'don&#39;t');
assert('Converts \\n to <br/>', escapeHtml('line1\nline2') === 'line1<br/>line2');
assert(
  'Defangs <img onerror>',
  escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;',
);
// Ampersand-first ordering matters — without it &lt; would become &amp;lt;
assert(
  'Ampersand escaped first (no double-escape)',
  escapeHtml('&amp;') === '&amp;amp;', // raw ampersand → &amp;, then no further mutation
);

// 2. Email helper uses escapeHtml on bodyPreview + authorName
console.log('\n2. Email helper hardening');
const emailSrc = readFileSync('lib/email.ts', 'utf8');
assert('escapeHtml exported', /export function escapeHtml/.test(emailSrc));
assert(
  'sendNewMediaMessageNotification escapes bodyPreview',
  /escapeHtml\(args\.bodyPreview\)/.test(emailSrc),
);
assert(
  'sendNewMediaMessageNotification escapes authorName',
  /safeAuthorName\s*=\s*escapeHtml\(args\.authorName\)/.test(emailSrc),
);
assert(
  'No raw bodyPreview interpolation in chat email',
  !/\$\{args\.bodyPreview\.replace/.test(emailSrc),
);

// 3. Webhook: error checks + claim rollback on insert failure
console.log('\n3. Webhook safety');
const webhookSrc = readFileSync('app/api/booking/webhook/route.ts', 'utf8');
assert(
  '3-day branch rolls back on insert failure',
  /3-day band row insert[\s\S]{0,500}stripe_webhook_events[\s\S]{0,200}\.delete/.test(webhookSrc),
);
assert(
  'Single-day branch checks insertErr + rolls back claim',
  /insertErr \|\| !row[\s\S]{0,500}stripe_webhook_events[\s\S]{0,200}\.delete/.test(webhookSrc),
);
assert(
  'Async branch checks asyncInsErr + rolls back claim',
  /asyncInsErr \|\| !newBooking[\s\S]{0,300}stripe_webhook_events[\s\S]{0,100}\.delete\(\)/.test(webhookSrc),
);
assert(
  'Sweet Spot parse failure rolls back claim',
  /sweet_spot_addon parse failed[\s\S]{0,200}stripe_webhook_events[\s\S]{0,100}\.delete\(\)/.test(webhookSrc),
);
assert(
  '3-day Day 1 remainder uses derived day1Remainder',
  /day1Remainder\s*=\s*Math\.max\(0, remainderCents - 2 \* perDayRemainder\)/.test(webhookSrc),
);
assert(
  '3-day Day 1 remainder no longer uses totalCents - depositCents - 2 * perDayTotal',
  !/totalCents - depositCents - 2 \* perDayTotal/.test(webhookSrc),
);

// 4. Respond pass branch checks update error
console.log('\n4. Respond pass branch');
const respondSrc = readFileSync('app/api/booking/respond/route.ts', 'utf8');
assert(
  'Pass branch destructures + checks passErr',
  /const \{ error: passErr \}[\s\S]{0,400}if \(passErr\)/.test(respondSrc),
);

// 5. Package PUT checks all writes + posts system message on prior approvals
console.log('\n5. Package PUT hardening');
const pkgSrc = readFileSync('app/api/media/bookings/[id]/package/route.ts', 'utf8');
assert(
  'Package update destructures pkgUpdErr',
  /const \{ error: pkgUpdErr \}/.test(pkgSrc),
);
assert(
  'Line item delete destructures delErr',
  /const \{ error: delErr \}/.test(pkgSrc),
);
assert(
  'Tracks priorApprovedCount before truncate',
  /priorApprovedCount\s*=\s*\(priorItems \?\? \[\]\)\.length/.test(pkgSrc),
);
assert(
  'Posts system message when prior approvals are wiped',
  /priorApprovedCount > 0[\s\S]{0,500}previously-approved line item/.test(pkgSrc),
);

// 6. Approve route checks all writes
console.log('\n6. Approve route hardening');
const approveSrc = readFileSync('app/api/media/bookings/[id]/package/line-items/[lineId]/approve/route.ts', 'utf8');
assert('Line item update checks lineUpdErr', /const \{ error: lineUpdErr \}/.test(approveSrc));
assert('Package status flip checks pkgFlipErr', /const \{ error: pkgFlipErr \}/.test(approveSrc));
assert('Booking status flip checks bookingFlipErr', /const \{ error: bookingFlipErr \}/.test(approveSrc));

// 7. Session approve marks sibling proposals superseded
console.log('\n7. Session approve');
const sessApprove = readFileSync('app/api/media/bookings/[id]/sessions/[sessionId]/approve/route.ts', 'utf8');
assert(
  'Approve marks sibling proposed sessions on same line item as superseded',
  /superseding sibling proposals|status:\s*'superseded'/.test(sessApprove) &&
  /\.eq\('line_item_id', session\.line_item_id\)/.test(sessApprove) &&
  /\.eq\('status', 'proposed'\)/.test(sessApprove) &&
  /\.neq\('id', sessionId\)/.test(sessApprove),
);

// 8. Line item complete: ternary fixed + drive_url clear works
console.log('\n8. Line item complete fixes');
const completeSrc = readFileSync('app/api/admin/media/bookings/[id]/line-items/[lineId]/complete/route.ts', 'utf8');
assert(
  'Re-mark preserves completed_at',
  /if \(!line\.completed\) updates\.completed_at = now/.test(completeSrc),
);
assert(
  'Empty drive_url string clears the column',
  /driveUrlProvided[\s\S]{0,150}updates\.drive_url = driveUrl \|\| null/.test(completeSrc),
);
assert(
  'Response uses freshly-read completed_at, not the broken ternary',
  /responseCompletedAt[\s\S]{0,300}refreshed[\s\S]{0,200}completed_at/.test(completeSrc),
);
assert(
  'Old broken ternary removed',
  !/completed \? line\.completed \? line\.notified_at \?\? null : now : null/.test(completeSrc),
);

console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
