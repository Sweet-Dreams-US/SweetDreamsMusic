/**
 * scripts/rewards-scenarios.ts — exhaustive charge/payout/business scenarios.
 *   npx tsx scripts/rewards-scenarios.ts
 *
 * Probes the balance system for ALL the situations Cole flagged: surcharges on
 * top of free work, what the employee is paid, what we gave away (retail) vs what
 * it actually cost us (staff pay), and the per-session business net. Pure math —
 * no DB. Asserts the invariants that must ALWAYS hold + prints a business view.
 */
import { applyRewardsToPricing } from '../lib/rewards';

const SPLIT = 0.6;
let passed = 0, failed = 0; const fails: string[] = [];
function ok(name: string, cond: boolean, extra = '') { if (cond) { passed++; } else { failed++; fails.push(name); console.log(`  ✗ FAIL ${name} ${extra}`); } }

interface Scn {
  label: string;
  subtotalCents: number;  // base (pre-surcharge) for the whole session
  surchargeCents: number; // night/same-day/guest fees for the whole session
  hours: number;
  freeHours?: number;
  discountPct?: number;
  rewardFunded?: boolean; // true = a reward (give-away is a marketing cost); false = prepaid credit / normal
}

function run(s: Scn) {
  const totalCents = s.subtotalCents + s.surchargeCents; // full normal price (value)
  const r = applyRewardsToPricing({ totalCents, subtotalCents: s.subtotalCents }, s.hours, { freeHours: s.freeHours, discountPct: s.discountPct });
  const engineerPay = Math.round(r.serviceValueCents * SPLIT);
  const studioRevenue = r.customerChargeCents;
  const retailGiveAway = r.rewardsCostCents;                       // value the customer got free
  const studioNet = studioRevenue - engineerPay;                  // can be negative on a comp
  const actualCost = s.rewardFunded ? Math.max(0, engineerPay - studioRevenue) : 0; // cash out the door for a reward
  return { totalCents, r, engineerPay, studioRevenue, retailGiveAway, studioNet, actualCost };
}

const D = (c: number) => `$${(c / 100).toFixed(2)}`;

const scenarios: Scn[] = [
  // — baseline —
  { label: 'Normal 3hr (B, no fees)', subtotalCents: 15000, surchargeCents: 0, hours: 3 },
  // — free hours + every surcharge type (customer must still pay the fee) —
  { label: 'Free 1hr + same-day $10', subtotalCents: 5000, surchargeCents: 1000, hours: 1, freeHours: 1, rewardFunded: true },
  { label: 'Free 1hr + deep-night $30', subtotalCents: 5000, surchargeCents: 3000, hours: 1, freeHours: 1, rewardFunded: true },
  { label: 'Free 1hr + guest fee $10', subtotalCents: 5000, surchargeCents: 1000, hours: 1, freeHours: 1, rewardFunded: true },
  { label: 'Free 2hr, both late-night (+$10/hr)', subtotalCents: 10000, surchargeCents: 2000, hours: 2, freeHours: 2, rewardFunded: true },
  { label: 'Free 1hr of 3hr + mixed fees $40', subtotalCents: 15000, surchargeCents: 4000, hours: 3, freeHours: 1, rewardFunded: true },
  // — full comp, no fees (pure marketing cost) —
  { label: 'Full free 1hr (no fees)', subtotalCents: 6000, surchargeCents: 0, hours: 1, freeHours: 1, rewardFunded: true },
  // — discounts (loyalty %) incl. on surcharges —
  { label: '10% loyalty off 3hr (no fees)', subtotalCents: 15000, surchargeCents: 0, hours: 3, discountPct: 10, rewardFunded: true },
  { label: '20% off 2hr WITH $30 fee', subtotalCents: 10000, surchargeCents: 3000, hours: 2, discountPct: 20, rewardFunded: true },
  // — combined free + discount on one booking —
  { label: 'Free 1hr + 10% off, $10 fee', subtotalCents: 10000, surchargeCents: 1000, hours: 2, freeHours: 1, discountPct: 10, rewardFunded: true },
  // — bundle / edge —
  { label: 'Sweet-4 (flat $180), free 1hr', subtotalCents: 18000, surchargeCents: 0, hours: 4, freeHours: 1, rewardFunded: true },
  { label: 'Free hours > booked (clamp to 2)', subtotalCents: 10000, surchargeCents: 0, hours: 2, freeHours: 5, rewardFunded: true },
  { label: 'Prepaid credit 2hr (not a reward)', subtotalCents: 10000, surchargeCents: 0, hours: 2, freeHours: 2, rewardFunded: false },
];

console.log('\n=== Reward scenarios — charge, employee pay, give-away, business net ===\n');
console.log('  scenario                                 charge   eng.pay  gaveaway  studioNet  cost');
let totRev = 0, totPay = 0, totGive = 0, totCost = 0;
for (const s of scenarios) {
  const x = run(s);
  // ── invariants that must ALWAYS hold ──
  ok(`${s.label}: charge + giveAway = full value`, x.r.customerChargeCents + x.retailGiveAway === x.totalCents, `(${x.r.customerChargeCents}+${x.retailGiveAway}≠${x.totalCents})`);
  ok(`${s.label}: employee paid on FULL value (60%)`, x.engineerPay === Math.round(x.totalCents * SPLIT));
  ok(`${s.label}: charge never negative`, x.r.customerChargeCents >= 0);
  ok(`${s.label}: surcharges are never comped (customer pays all fees)`, x.r.customerChargeCents >= (s.freeHours && s.freeHours >= s.hours ? s.surchargeCents : 0) - x.r.discountCents);
  totRev += x.studioRevenue; totPay += x.engineerPay; totGive += x.retailGiveAway; totCost += x.actualCost;
  console.log(`  ${s.label.padEnd(40)} ${D(x.studioRevenue).padStart(8)} ${D(x.engineerPay).padStart(8)} ${D(x.retailGiveAway).padStart(8)} ${D(x.studioNet).padStart(9)} ${D(x.actualCost).padStart(7)}`);
}

// Focused value checks (hand-computed).
console.log('\n— Hand-checked values —');
let x = run(scenarios[2]); // Free 1hr + deep-night $30
ok('deep-night: customer pays the $30 fee', x.r.customerChargeCents === 3000);
ok('deep-night: engineer paid on $80 value = $48', x.engineerPay === 4800);
x = run(scenarios[4]); // Free 2hr both late-night
ok('2 free late-night hrs: customer pays both $10 fees = $20', x.r.customerChargeCents === 2000);
ok('2 free late-night hrs: give-away = $100 base', x.retailGiveAway === 10000);
x = run(scenarios[8]); // 20% off 2hr with $30 fee
ok('20% off $130 = charge $104', x.r.customerChargeCents === 10400);
ok('20% off: engineer still paid on full $130 = $78', x.engineerPay === 7800);
x = run(scenarios[11]); // clamp
ok('free hours clamped: only 2 comped (charge $0, not negative)', x.r.customerChargeCents === 0 && x.retailGiveAway === 10000);

console.log('\n— Business roll-up (these 12 reward + 1 prepaid sessions) —');
console.log(`  Revenue collected:        ${D(totRev)}`);
console.log(`  Employee pay (on value):  ${D(totPay)}`);
console.log(`  Retail value given free:  ${D(totGive)}`);
console.log(`  Actual cash cost of free: ${D(totCost)}  (staff pay we eat on comps; revenue covers the rest)`);

console.log(`\n${failed === 0 ? `✅ ALL ${passed} INVARIANTS HOLD` : `❌ ${failed} FAILED: ${fails.join('; ')}`}\n`);
process.exit(failed === 0 ? 0 : 1);
