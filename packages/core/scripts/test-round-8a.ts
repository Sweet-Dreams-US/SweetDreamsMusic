/**
 * scripts/test-round-8a.ts
 *
 * Round 8a invariant checks:
 *   1. ENGINEERS roster still contains Iszac at the canonical name we depend on
 *   2. booking/create/route.ts contains the server-side band override
 *   3. webhook handles band bookings via Iszac priority, not the all-engineers fan-out
 *   4. respond/route.ts pass branch routes bands to admin reschedule path
 *
 * These are static / source-level checks — no DB or HTTP calls.
 * Run: npx tsx --env-file=.env.local scripts/test-round-8a.ts
 */

import { readFileSync } from 'fs';
import { ENGINEERS } from '../lib/constants';

let failures = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

console.log('Round 8a invariant checks\n');

// 1. Iszac in roster, canonical fields the new code depends on.
console.log('1. ENGINEERS roster integrity');
const iszac = ENGINEERS.find((e) => e.displayName === 'Iszac');
assert('Iszac exists by displayName', !!iszac);
assert("Iszac's canonical name is 'Iszac Griner'", iszac?.name === 'Iszac Griner');
assert("Iszac's email is iisszzaacc@gmail.com", iszac?.email === 'iisszzaacc@gmail.com');
assert('Iszac is in studio_a', !!iszac?.studios.includes('studio_a'));

// 2. booking/create route contains the band override.
console.log('\n2. booking/create override');
const createSrc = readFileSync('app/api/booking/create/route.ts', 'utf8');
assert(
  'Destructures rawEngineer (not engineer) from body',
  /engineer:\s*rawEngineer/.test(createSrc),
);
assert(
  'requestedEngineer ternary forces Iszac when isBandBooking',
  /isBandBooking\s*\?\s*'Iszac Griner'/.test(createSrc),
);
assert(
  'Stripe metadata uses requestedEngineer (not raw body engineer)',
  /engineer:\s*requestedEngineer/.test(createSrc),
);
assert(
  'Old `engineer || ""` pattern removed',
  !/engineer:\s*engineer\s*\|\|\s*''/.test(createSrc),
);

// 3. Webhook routes bands to Iszac, never fans out.
console.log('\n3. webhook band routing');
const webhookSrc = readFileSync('app/api/booking/webhook/route.ts', 'utf8');
assert(
  'Sync branch uses isBandBooking guard for Iszac priority',
  /if\s*\(isBandBooking\)\s*{\s*\n[\s\S]*?ENGINEERS\.find\(\(e\)\s*=>\s*e\.displayName\s*===\s*'Iszac'/.test(webhookSrc),
);
assert(
  'Async branch uses isAsyncBandBooking',
  /isAsyncBandBooking/.test(webhookSrc),
);
assert(
  'priorityExpiry computed for bands even when meta.engineer empty (sync)',
  /\(meta\.engineer\s*\|\|\s*isBandBooking\)/.test(webhookSrc),
);
assert(
  'priorityExpiry computed for bands even when asyncMeta.engineer empty (async)',
  /\(asyncMeta\.engineer\s*\|\|\s*isAsyncBandBooking\)/.test(webhookSrc),
);

// 4. respond/route.ts pass branch — bands go to admin, not other engineers.
console.log('\n4. respond/route.ts pass branch');
const respondSrc = readFileSync('app/api/booking/respond/route.ts', 'utf8');
assert(
  'Imports sendBandSessionNeedsRescheduleAdmin',
  /sendBandSessionNeedsRescheduleAdmin/.test(respondSrc),
);
assert(
  'Pass branch checks for booking.band_id',
  /isBandBooking\s*=\s*!!booking\.band_id/.test(respondSrc),
);
assert(
  'Band pass returns early before all-engineer fan-out',
  /if\s*\(isBandBooking\)\s*{\s*\n[\s\S]*?sendBandSessionNeedsRescheduleAdmin[\s\S]*?return NextResponse/.test(respondSrc),
);

// 5. BookingFlow.tsx hides picker for bands.
console.log('\n5. BookingFlow.tsx UI guard');
const flowSrc = readFileSync('components/booking/BookingFlow.tsx', 'utf8');
assert(
  'useEffect forces Iszac when isBandMode',
  /if\s*\(isBandMode\)\s*{\s*\n[\s\S]*?setEngineer\('Iszac Griner'\)/.test(flowSrc),
);
assert(
  'Picker conditionally rendered on isBandMode',
  /\{isBandMode\s*\?\s*\(/.test(flowSrc),
);

// 6. lib/email.ts exports the new admin reschedule helper.
console.log('\n6. lib/email.ts new helper');
const emailSrc = readFileSync('lib/email.ts', 'utf8');
assert(
  'sendBandSessionNeedsRescheduleAdmin exported',
  /export\s+async\s+function\s+sendBandSessionNeedsRescheduleAdmin/.test(emailSrc),
);
assert(
  'Routes to SUPER_ADMINS',
  /sendBandSessionNeedsRescheduleAdmin[\s\S]{0,500}\[\.\.\.SUPER_ADMINS\]/.test(emailSrc),
);

console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
