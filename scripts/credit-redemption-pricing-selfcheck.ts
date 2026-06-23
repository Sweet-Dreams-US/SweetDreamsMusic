// scripts/credit-redemption-pricing-selfcheck.ts
//
// Proves lib/credit-redemption-pricing.ts reproduces the confirmed worked
// examples (studio_b; cents) under the 2026-06-22 rules: free hour worth $60 on a
// 1-hour session ($50 on 2+), and the tiered Booking Rush Fee passed in as
// rushPerHourCents. Pure — uses the constants-backed StudioConfig (no DB/env).
//
//   npx tsx scripts/credit-redemption-pricing-selfcheck.ts
//
// Exits non-zero on any mismatch so it can gate CI.

import { studioConfigFromConstants } from '@/lib/studio-config';
import {
  computeCreditRedemptionPricing,
  type CreditRedemptionPricing,
} from '@/lib/credit-redemption-pricing';

const cfg = studioConfigFromConstants('studio_b');

let failures = 0;
function check(
  name: string,
  got: CreditRedemptionPricing,
  expect: Partial<CreditRedemptionPricing>,
) {
  const mismatches: string[] = [];
  for (const [k, v] of Object.entries(expect)) {
    const actual = (got as unknown as Record<string, number>)[k];
    if (actual !== v) mismatches.push(`${k}: expected ${v}, got ${actual}`);
  }
  if (mismatches.length) {
    failures++;
    console.error(`✗ ${name}\n    ${mismatches.join('\n    ')}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// 1. 1hr, 11pm (late $10), rush $10/hr → total 8000 (6000 base + 1000 late + 1000 rush).
//    Free hour on a 1hr session = $60 → discount 6000, payNow 2000, remainder 0.
check(
  'Ex1: 1hr 11pm + rush $10',
  computeCreditRedemptionPricing({
    room: 'studio_b', hours: 1, startHourLocal: 23, rushPerHourCents: 1000,
    guestCount: 0, creditHoursRemaining: 1, pricing: cfg,
  }),
  { total: 8000, discount: 6000, amountDueNow: 2000, remainder: 0, creditHoursApplied: 1 },
);

// 2. 1hr, 11pm (late $10), no rush → total 7000. Free hour $60 → discount 6000,
//    payNow 1000, remainder 0.
check(
  'Ex2: 1hr 11pm no rush',
  computeCreditRedemptionPricing({
    room: 'studio_b', hours: 1, startHourLocal: 23, rushPerHourCents: 0,
    guestCount: 0, creditHoursRemaining: 1, pricing: cfg,
  }),
  { total: 7000, discount: 6000, amountDueNow: 1000, remainder: 0, creditHoursApplied: 1 },
);

// 3. 1hr, 2pm, no rush, 1 guest (free) → total 6000. Free hour $60 fully covers it
//    → discount 6000, payNow 0 (instant confirm), remainder 0.
check(
  'Ex3: 1hr 2pm no rush 1 guest',
  computeCreditRedemptionPricing({
    room: 'studio_b', hours: 1, startHourLocal: 14, rushPerHourCents: 0,
    guestCount: 1, creditHoursRemaining: 1, pricing: cfg,
  }),
  { total: 6000, discount: 6000, amountDueNow: 0, remainder: 0, creditHoursApplied: 1 },
);

// 4. 3hr, 11pm, rush $10/hr → base 15000, surcharge 6000 (3×1000 late + 3×1000 rush),
//    total 21000, deposit 10500. Free hour on a 2+hr session = $50 → discount 5000,
//    payNow 5500, remainder 10500, netTotal 16000.
check(
  'Ex4: 3hr 11pm + rush $10',
  computeCreditRedemptionPricing({
    room: 'studio_b', hours: 3, startHourLocal: 23, rushPerHourCents: 1000,
    guestCount: 0, creditHoursRemaining: 1, pricing: cfg,
  }),
  {
    base: 15000, surcharges: 6000, total: 21000, deposit: 10500,
    discount: 5000, amountDueNow: 5500, remainder: 10500, netTotal: 16000,
    creditHoursApplied: 1,
  },
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll 4 credit-redemption pricing examples passed.');
