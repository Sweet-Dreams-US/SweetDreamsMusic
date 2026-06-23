// scripts/rush-fee-golden.ts
// Golden test for the tiered Booking Rush Fee. Run: npx tsx scripts/rush-fee-golden.ts
// Asserts every tier + boundary, including the cross-midnight $30 case, using
// explicit UTC instants for `now` (June = EDT = UTC-4 in Fort Wayne/Indianapolis).

import { rushFeePerHourCents, hoursUntilSession } from '../lib/rush-fee';

let failures = 0;
function check(label: string, got: number, want: number) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${got} want=${want}`);
}

// 2026-06-22T17:00:00Z === 1:00pm EDT (13.0) in Fort Wayne. todayEastern=2026-06-22.
const noon = new Date('2026-06-22T17:00:00Z');
check('same day, 1.0h out  -> $30', rushFeePerHourCents(noon, '2026-06-22', 14.0), 3000);
check('same day, 0.5h out  -> $30', rushFeePerHourCents(noon, '2026-06-22', 13.5), 3000);
check('same day, exactly 2h-> $20', rushFeePerHourCents(noon, '2026-06-22', 15.0), 2000);
check('same day, 3.0h out  -> $20', rushFeePerHourCents(noon, '2026-06-22', 16.0), 2000);
check('same day, exactly 4h-> $10', rushFeePerHourCents(noon, '2026-06-22', 17.0), 1000);
check('same day, 7.0h out  -> $10', rushFeePerHourCents(noon, '2026-06-22', 20.0), 1000);
check('same day, 10.5h out -> $10', rushFeePerHourCents(noon, '2026-06-22', 23.5), 1000);
check('next day, ~17h out  -> $0 ', rushFeePerHourCents(noon, '2026-06-23', 6.0), 0);

// Cross-midnight rush: 2026-06-23T03:50:00Z === 2026-06-22 11:50pm EDT (23.83).
const lateNight = new Date('2026-06-23T03:50:00Z');
check('11:50pm -> 1am (1.17h) -> $30', rushFeePerHourCents(lateNight, '2026-06-23', 1.0), 3000);
check('11:50pm -> 9am (9.17h) -> $10', rushFeePerHourCents(lateNight, '2026-06-23', 9.0), 1000);

// 12:10am -> 8am same day (7.83h) -> $10. 2026-06-22T04:10:00Z === 12:10am EDT.
const justAfterMidnight = new Date('2026-06-22T04:10:00Z');
check('12:10am -> 8am (7.83h) -> $10', rushFeePerHourCents(justAfterMidnight, '2026-06-22', 8.0), 1000);

// 12+ hours out -> $0 (e.g. tomorrow afternoon from noon today ~25h).
check('25h out -> $0', rushFeePerHourCents(noon, '2026-06-23', 14.0), 0);
// exactly 12h out -> $0 (boundary).
check('exactly 12h -> $0', rushFeePerHourCents(noon, '2026-06-23', 1.0), 0);

// Sanity on the hours math itself.
const h = hoursUntilSession(lateNight, '2026-06-23', 1.0);
check('hoursUntil 11:50pm->1am ~1.17', Math.round(h * 100), 117);

console.log(failures === 0 ? '\nALL GOLDEN CASES PASS' : `\n${failures} GOLDEN CASE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
