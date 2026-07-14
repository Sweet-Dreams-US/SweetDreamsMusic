// scripts/half-hour-pricing-selfcheck.ts
//
// Locks the half-hour add-on pricing (Cole 2026-07): sessions run in 30-min
// steps (min 1hr); each trailing half-hour adds a FLAT fee (Studio A $35,
// Studio B $25) PLUS pro-rated (×0.5) night/same-day/guest surcharges. Also
// asserts whole-hour durations are UNCHANGED (golden-safe).
//
//   npx tsx scripts/half-hour-pricing-selfcheck.ts
//
// Exits non-zero on any mismatch so it can gate CI.

import { studioConfigFromConstants, priceSessionFromConfig } from '@/lib/studio-config';

const b = studioConfigFromConstants('studio_b'); // $50/hr, $60 single, half $25
const a = studioConfigFromConstants('studio_a'); // $70/hr, $80 single, half $35

let failures = 0;
function check(name: string, got: number, expect: number) {
  if (got !== expect) { failures++; console.error(`✗ ${name}: expected ${expect}, got ${got}`); }
  else console.log(`✓ ${name} = ${expect}`);
}

const price = (cfg: typeof b, hours: number, startHour: number, sameDay: boolean, guests: number) =>
  priceSessionFromConfig(cfg, { hours, startHour, sameDay, guests });

// ── Whole-hour GOLDEN cases (must be unchanged) ──────────────────────────────
check('B 1h 2pm', price(b, 1, 14, false, 0).total, 6000);        // single-hour rate
check('B 2h 2pm', price(b, 2, 14, false, 0).total, 10000);       // 2 × $50
check('A 3h 2pm', price(a, 3, 14, false, 0).total, 21000);       // 3 × $70

// ── Half-hour, no surcharges ─────────────────────────────────────────────────
// 1.5h Studio B @ 2pm: 1 whole hour at single ($60) + $25 half = $85.
check('B 1.5h 2pm', price(b, 1.5, 14, false, 0).total, 8500);
// 2.5h Studio B @ 2pm: 2 × $50 + $25 = $125.
check('B 2.5h 2pm', price(b, 2.5, 14, false, 0).total, 12500);
// 1.5h Studio A @ 2pm: single ($80) + $35 = $115.
check('A 1.5h 2pm', price(a, 1.5, 14, false, 0).total, 11500);

// ── Half-hour with pro-rated surcharges ──────────────────────────────────────
// 1.5h Studio B @ 11pm, same-day:
//   whole hour 23:00 → $60 + $10 late + $10 same-day
//   half slot 00:00 (late-night window) → $25 flat + $5 late (½) + $5 same-day (½)
//   total = (6000+2500) + (1000+500) + (1000+500) = 11500
const late = price(b, 1.5, 23, true, 0);
check('B 1.5h 11pm same-day subtotal', late.subtotal, 8500);
check('B 1.5h 11pm same-day nightFees', late.nightFees, 1500);
check('B 1.5h 11pm same-day sameDayFee', late.sameDayFee, 1500);
check('B 1.5h 11pm same-day total', late.total, 11500);
check('B 1.5h 11pm same-day deposit', late.deposit, 5750);

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nAll half-hour pricing examples passed.');
