// scripts/check-studio-time.ts — run with: npx tsx scripts/check-studio-time.ts
// Asserts the two studio-time families behave correctly. Throws (non-zero exit)
// on mismatch. No test framework in this repo, so this is a plain script.
import {
  fmtSessionTime, fmtSessionDate, fmtStampTime,
} from '../lib/studio-time';

function assertEq(label: string, got: string, want: string) {
  if (got !== want) {
    console.error(`FAIL ${label}: got "${got}", want "${want}"`);
    process.exit(1);
  }
  console.log(`ok   ${label}: "${got}"`);
}

// Wall-clock-as-UTC: a 6:00 PM session stored as 18:00Z must read back as 6:00 PM.
assertEq('session 18:00Z -> 6:00 PM', fmtSessionTime('2026-06-01T18:00:00+00:00'), '6:00 PM');
assertEq('session 00:30Z -> 12:30 AM', fmtSessionTime('2026-06-01T00:30:00+00:00'), '12:30 AM');
assertEq('session date', fmtSessionDate('2026-06-01T18:00:00+00:00'), 'Jun 1, 2026');

// True-UTC instant: 22:00Z in summer (EDT, UTC-4) is 6:00 PM Eastern.
assertEq('stamp 22:00Z -> 6:00 PM EDT', fmtStampTime('2026-07-01T22:00:00Z'), '6:00 PM');
// Winter (EST, UTC-5): 23:00Z is 6:00 PM Eastern.
assertEq('stamp 23:00Z -> 6:00 PM EST', fmtStampTime('2026-01-01T23:00:00Z'), '6:00 PM');

// Null/invalid -> empty string.
assertEq('null -> empty', fmtSessionTime(null), '');
assertEq('garbage -> empty', fmtStampTime('not-a-date'), '');

console.log('\nAll studio-time assertions passed.');
