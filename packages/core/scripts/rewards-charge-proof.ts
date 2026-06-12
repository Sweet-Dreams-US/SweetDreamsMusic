/**
 * scripts/rewards-charge-proof.ts — proves the reward charge math (no DB).
 *   npx tsx scripts/rewards-charge-proof.ts
 *
 * Verifies Cole's rules: free hours comp the BASE only (surcharges still charged),
 * partial free + paid remainder, best-of discount on the remainder, and that staff
 * are always paid 60% of the FULL value.
 */
import { applyRewardsToPricing } from '../lib/rewards';

const SPLIT = 0.6;
let failures = 0;
function check(name: string, got: number, want: number) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${name.padEnd(46)} got ${got}  want ${want}`);
}
function row(label: string, r: ReturnType<typeof applyRewardsToPricing>) {
  const engineer = Math.round(r.serviceValueCents * SPLIT);
  console.log(`\n${label}`);
  console.log(`  value $${(r.serviceValueCents/100).toFixed(2)}  charge $${(r.customerChargeCents/100).toFixed(2)}  ` +
    `deposit $${(r.depositCents/100).toFixed(2)}  engineer $${(engineer/100).toFixed(2)}  ` +
    `rewardsCost $${(r.rewardsCostCents/100).toFixed(2)}`);
  return r;
}

console.log('=== Reward charge math proof (Studio B, $50/hr base) ===');

// 1) Normal 3hr, no fees.
let r = row('1) Normal 3hr ($150)', applyRewardsToPricing({ totalCents: 15000, subtotalCents: 15000 }, 3, {}));
check('normal charge', r.customerChargeCents, 15000);
check('normal engineer pay', Math.round(r.serviceValueCents * SPLIT), 9000);
check('normal rewards cost', r.rewardsCostCents, 0);

// 2) 25%-off reward, 3hr no fees.
r = row('2) 25% off 3hr', applyRewardsToPricing({ totalCents: 15000, subtotalCents: 15000 }, 3, { discountPct: 25 }));
check('discount charge', r.customerChargeCents, 11250);
check('discount engineer pay (full value)', Math.round(r.serviceValueCents * SPLIT), 9000);
check('discount rewards cost', r.rewardsCostCents, 3750);

// 3) Free 1hr, no fees (base $50).
r = row('3) Free 1hr (no fees)', applyRewardsToPricing({ totalCents: 5000, subtotalCents: 5000 }, 1, { freeHours: 1 }));
check('free-hr charge', r.customerChargeCents, 0);
check('free-hr engineer pay', Math.round(r.serviceValueCents * SPLIT), 3000);
check('free-hr rewards cost', r.rewardsCostCents, 5000);

// 4) Free 1hr WITH a $10 same-day fee — customer STILL pays the fee (Cole's nuance).
r = row('4) Free 1hr + $10 same-day fee', applyRewardsToPricing({ totalCents: 6000, subtotalCents: 5000 }, 1, { freeHours: 1 }));
check('free-hr+fee charge (pays the fee)', r.customerChargeCents, 1000);
check('free-hr+fee engineer pay', Math.round(r.serviceValueCents * SPLIT), 3600);
check('free-hr+fee rewards cost (base only)', r.rewardsCostCents, 5000);

// 5) Partial: 3hr booking, 1 free hour, no fees → 2 hrs paid.
r = row('5) Partial: 3hr, 1 free hour', applyRewardsToPricing({ totalCents: 15000, subtotalCents: 15000 }, 3, { freeHours: 1 }));
check('partial charge (2 paid hrs)', r.customerChargeCents, 10000);
check('partial engineer pay (full value)', Math.round(r.serviceValueCents * SPLIT), 9000);
check('partial rewards cost (1 hr base)', r.rewardsCostCents, 5000);

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASS' : `❌ ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
