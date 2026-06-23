/**
 * scripts/rewards-real-fees.ts — rewards math on REAL studio pricing.
 *   npx tsx scripts/rewards-real-fees.ts
 *
 * Feeds calculateSessionTotal (the actual booking pricing) into applyRewardsToPricing
 * so every fee is derived from real rules — answering "how can a 3hr session have $40
 * in fees" (answer: fees STACK — booking rush $10/hr + late-night $10/hr + guests $10/hr).
 */
import { calculateSessionTotal } from '../lib/utils';
import { applyRewardsToPricing } from '../lib/rewards';

const D = (c: number) => `$${(c / 100).toFixed(2)}`;
const SPLIT = 0.6;

interface Case { label: string; room: 'studio_a' | 'studio_b'; hours: number; startHour: number; rushPerHourCents: number; guests: number; freeHours?: number; discountPct?: number }

const cases: Case[] = [
  { label: '3hr B, 8PM, rush $10/hr (→ exactly $40 fees), free 1hr', room: 'studio_b', hours: 3, startHour: 20, rushPerHourCents: 1000, guests: 1, freeHours: 1 },
  { label: '3hr B, 11PM rush $10/hr (3 late-night hrs + rush)', room: 'studio_b', hours: 3, startHour: 23, rushPerHourCents: 1000, guests: 1, freeHours: 1 },
  { label: '2hr A, 3AM (deep-night $30/hr), free 1hr', room: 'studio_a', hours: 2, startHour: 3, rushPerHourCents: 0, guests: 1, freeHours: 1 },
  { label: '3hr B, 2PM, 5 guests (2 extra), free 1hr', room: 'studio_b', hours: 3, startHour: 14, rushPerHourCents: 0, guests: 5, freeHours: 1 },
  { label: '4hr B Sweet-4, 7PM, free 1hr', room: 'studio_b', hours: 4, startHour: 19, rushPerHourCents: 0, guests: 1, freeHours: 1 },
  { label: '2hr B, 1AM, rush $30/hr (under-2hr tier), free 1hr', room: 'studio_b', hours: 2, startHour: 1, rushPerHourCents: 3000, guests: 1, freeHours: 1 },
  { label: '3hr B, 2PM, 10% loyalty off (no fees)', room: 'studio_b', hours: 3, startHour: 14, rushPerHourCents: 0, guests: 1, discountPct: 10 },
];

console.log('\n=== Rewards on REAL studio pricing (fees derived, not invented) ===\n');
for (const c of cases) {
  const p = calculateSessionTotal(c.room, c.hours, c.startHour, c.rushPerHourCents, c.guests);
  const fees = p.nightFees + p.bookingRushFee + p.guestFee;
  const r = applyRewardsToPricing({ totalCents: p.total, subtotalCents: p.subtotal }, c.hours, { freeHours: c.freeHours, discountPct: c.discountPct });
  const engineerPay = Math.round(r.serviceValueCents * SPLIT);
  console.log(c.label);
  console.log(`  base ${D(p.subtotal)}  + night ${D(p.nightFees)} + rush ${D(p.bookingRushFee)} + guest ${D(p.guestFee)} = fees ${D(fees)}  → full value ${D(p.total)}`);
  console.log(`  customer pays ${D(r.customerChargeCents)}   engineer paid ${D(engineerPay)} (on full value)   gave away ${D(r.rewardsCostCents)}\n`);
}

// The headline answer, asserted.
const eightPM = calculateSessionTotal('studio_b', 3, 20, 1000, 1);
console.log('— The $40 question —');
console.log(`  3hr Studio B, rush $10/hr, 8PM start: rush $10×3 = ${D(eightPM.bookingRushFee)} + late-night (10PM hr) = ${D(eightPM.nightFees)} → fees ${D(eightPM.bookingRushFee + eightPM.nightFees)}`);
console.log(`  ${eightPM.bookingRushFee + eightPM.nightFees === 4000 ? '✓ exactly $40 — fees STACK, so $40 on a 3hr session is real' : '✗ unexpected'}\n`);
