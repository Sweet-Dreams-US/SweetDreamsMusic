// scripts/tax-center-test.ts — golden test for the Tax Center (Plan 5).
// Run: npx tsx --env-file=.env.local scripts/tax-center-test.ts
//
// PURE: SE-tax (with wage-base cap), income tax, quarterly catch-up across all
// four quarters, $600 1099 threshold at EXACTLY 60000 cents, entity-type
// behavior, category normalization — all against hand-computed fixtures.
// LIVE: P&L revenue reconciles to a direct recompute of the accounting gross
// definition to the cent; contractor YTD includes cash + sums to total payouts;
// a no-profile path never NaNs.

import { createClient } from '@supabase/supabase-js';
import {
  seTaxCents, incomeTaxCents, computeQuarterlyEstimate, needs1099,
  contractorCompliance, normalizeCategory, quarterOfMonth, daysUntil,
  qbiDeductionCents, deductiblePctFor,
  type TaxConstants,
} from '../lib/tax';
import {
  taxRevenueForRange, computePnL, contractorDashboard, computeEstimates,
  contractorPaidForRange, staffEarningsForRange, getTaxConstants,
} from '../lib/tax-server';
import { materializeRecurringExpenses } from '../lib/tax-recurring-server';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing env. Run with --env-file=.env.local'); process.exit(1); }
const db = createClient(URL, KEY);

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// 2026 draft constants (mirror the seed; the test asserts MATH, not that the
// rates are IRS-correct — that's the CPA's job).
const BASE = {
  seNetFactor: 0.9235, seTaxRate: 0.1530,
  ssWageBaseCents: 18420000, ssRate: 0.1240, medicareRate: 0.0290,
  dueDates: { '1': '2026-04-15', '2': '2026-06-15', '3': '2026-09-15', '4': '2027-01-15' },
  reviewed: false,
  sec179LimitCents: null, sec179PhaseoutCents: null,
};
// 2025 law: $600 threshold, staff meals 50%, no QBI $400 minimum.
const C: TaxConstants = {
  ...BASE, taxYear: 2025, nineteen99ThresholdCents: 60000,
  qbiPct: 20, qbiMinDeductionCents: null, qbiMinQbiFloorCents: null,
  deductiblePcts: { meals_clients: 50, meals_staff: 50, entertainment: 0, meals: 50 },
};
// 2026 law (OBBBA): $2,000 threshold, staff meals 0%, QBI $400 min at $1,000+.
const C26: TaxConstants = {
  ...BASE, taxYear: 2026, nineteen99ThresholdCents: 200000,
  qbiPct: 20, qbiMinDeductionCents: 40000, qbiMinQbiFloorCents: 100000,
  deductiblePcts: { meals_clients: 50, meals_staff: 0, entertainment: 0, meals: 50 },
};
// QBI-off variant for the income-tax baseline assertions.
const C_NOQBI: TaxConstants = { ...C, qbiPct: null };

async function main() {
  console.log('\n— Pure: SE tax (hand-computed) —');
  // net $50,000: base=round(5,000,000*0.9235)=4,617,500; ss=round(*0.124)=572,570;
  // medicare=round(*0.029)=133,908; SE=706,478.
  ok('SE tax on $50k net = $7,064.78', seTaxCents(5_000_000, C, 'sole_prop') === 706478,
    `got ${seTaxCents(5_000_000, C, 'sole_prop')}`);
  // net $300,000: base=27,705,000 > wage base → SS capped at 18,420,000*0.124=2,284,080;
  // medicare=round(27,705,000*0.029)=803,445; SE=3,087,525.
  ok('SE tax respects the SS wage-base cap at $300k', seTaxCents(30_000_000, C, 'sole_prop') === 3087525,
    `got ${seTaxCents(30_000_000, C, 'sole_prop')}`);
  ok('smllc owes SE tax (same as sole prop)', seTaxCents(5_000_000, C, 'smllc') === 706478);
  ok('S corp owes NO SE tax (payroll handles it)', seTaxCents(5_000_000, C, 's_corp') === 0);
  ok('partnership owes NO studio-level SE tax', seTaxCents(5_000_000, C, 'partnership') === 0);
  ok('negative net ⇒ no SE tax', seTaxCents(-100000, C, 'sole_prop') === 0);

  console.log('\n— Pure: income tax —');
  ok('22% income tax on $50k = $11,000', incomeTaxCents(5_000_000, 22) === 1_100_000);
  ok('income tax on $0 net = 0', incomeTaxCents(0, 22) === 0);
  ok('income tax on loss = 0', incomeTaxCents(-5000, 22) === 0);

  console.log('\n— Pure: quarterly catch-up (S corp, 20%, +$10k net/quarter) —');
  let prior = 0;
  const expected = [200000, 200000, 200000, 200000]; // each Q asks for $2,000 incremental
  for (let q = 1; q <= 4; q++) {
    const est = computeQuarterlyEstimate({
      ytdRevenueCents: q * 1_000_000, ytdExpensesCents: 0,
      entityType: 's_corp', incomeTaxRatePct: 20, constants: C_NOQBI, priorSuggestedCents: prior,
    });
    ok(`Q${q} suggested = $2,000`, est.suggestedPaymentCents === expected[q - 1],
      `got ${est.suggestedPaymentCents}`);
    prior += est.suggestedPaymentCents;
  }
  // Flat income (no growth after Q1) ⇒ later quarters ask for $0, never negative.
  const flatQ2 = computeQuarterlyEstimate({
    ytdRevenueCents: 4_000_000, ytdExpensesCents: 0, entityType: 's_corp',
    incomeTaxRatePct: 20, constants: C_NOQBI, priorSuggestedCents: 800000, // Q1 already suggested 20% of 40k
  });
  ok('no income growth ⇒ $0 this quarter (never negative)', flatQ2.suggestedPaymentCents === 0,
    `got ${flatQ2.suggestedPaymentCents}`);

  console.log('\n— Pure: 1099 threshold ($600 = 60000 cents) —');
  ok('2025 law: $599.99 ⇒ no 1099', !needs1099(59999, C));
  ok('2025 law: exactly $600.00 ⇒ 1099 required', needs1099(60000, C));
  ok('2025 law: $600.01 ⇒ 1099 required', needs1099(60001, C));
  // OBBBA: the SAME dollar amounts against 2026-law constants — $600 paid in
  // 2026 does NOT flag; $2,000 does. Same contractor, different payment year.
  ok('2026 law: $600 paid in 2026 ⇒ NO 1099 (threshold is $2,000)', !needs1099(60000, C26));
  ok('2026 law: $1,999.99 ⇒ no 1099', !needs1099(199999, C26));
  ok('2026 law: exactly $2,000.00 ⇒ 1099 required', needs1099(200000, C26));
  ok('over threshold + no W-9 ⇒ loud flag', contractorCompliance({ ytdPaidCents: 60000, hasW9: false, constants: C }).flag === 'needs_1099_missing_w9');
  ok('over threshold + W-9 ⇒ needs_1099', contractorCompliance({ ytdPaidCents: 60000, hasW9: true, constants: C }).flag === 'needs_1099');
  ok('under threshold ⇒ below_threshold', contractorCompliance({ ytdPaidCents: 1, hasW9: false, constants: C }).flag === 'below_threshold');

  console.log('\n— Pure (v2): QBI — hand-computed fixtures —');
  // net $50,000 @ 22%, QBI ON: deduction = 20% of 5,000,000 = 1,000,000;
  // income tax = 22% of 4,000,000 = 880,000. QBI OFF: 22% of 5,000,000 = 1,100,000.
  const qbiOn = computeQuarterlyEstimate({
    ytdRevenueCents: 5_000_000, ytdExpensesCents: 0, entityType: 's_corp',
    incomeTaxRatePct: 22, constants: C26, priorSuggestedCents: 0, applyQbi: true,
  });
  const qbiOff = computeQuarterlyEstimate({
    ytdRevenueCents: 5_000_000, ytdExpensesCents: 0, entityType: 's_corp',
    incomeTaxRatePct: 22, constants: C26, priorSuggestedCents: 0, applyQbi: false,
  });
  ok('QBI on: $50k net ⇒ deduction $10,000, income tax $8,800',
    qbiOn.qbiDeductionCents === 1_000_000 && qbiOn.incomeTaxCents === 880_000,
    `qbi ${qbiOn.qbiDeductionCents} inc ${qbiOn.incomeTaxCents}`);
  ok('QBI off: same net ⇒ income tax $11,000 (no deduction)',
    qbiOff.qbiDeductionCents === 0 && qbiOff.incomeTaxCents === 1_100_000);
  ok('SE tax identical with QBI on/off (QBI never reduces SE)',
    computeQuarterlyEstimate({ ytdRevenueCents: 5_000_000, ytdExpensesCents: 0, entityType: 'sole_prop', incomeTaxRatePct: 22, constants: C26, priorSuggestedCents: 0, applyQbi: true }).seTaxCents
    === computeQuarterlyEstimate({ ytdRevenueCents: 5_000_000, ytdExpensesCents: 0, entityType: 'sole_prop', incomeTaxRatePct: 22, constants: C26, priorSuggestedCents: 0, applyQbi: false }).seTaxCents);
  // $400 minimum (2026): QBI $1,500 → 20% = $300 < $400 and ≥ $1,000 floor → $400.
  ok('$400 minimum applies: $1,500 QBI ⇒ deduction $400 (not $300)',
    qbiDeductionCents(150_000, C26) === 40_000, `got ${qbiDeductionCents(150_000, C26)}`);
  // Below the $1,000 floor the minimum does NOT apply: $900 → 20% = $180.
  ok('below $1,000 floor: $900 QBI ⇒ deduction $180 (no minimum)',
    qbiDeductionCents(90_000, C26) === 18_000, `got ${qbiDeductionCents(90_000, C26)}`);
  // 2025 law has no minimum: $1,500 → $300.
  ok('2025 law: $1,500 QBI ⇒ $300 (no $400 minimum yet)',
    qbiDeductionCents(150_000, C) === 30_000);
  ok('deduction clamped to net (tiny net)', qbiDeductionCents(10, C26) <= 10);

  console.log('\n— Pure (v2): per-year deductibility (meals/entertainment) —');
  ok('meals_staff: 50% in 2025, 0% in 2026 (TCJA disallowance)',
    deductiblePctFor('meals_staff', C) === 50 && deductiblePctFor('meals_staff', C26) === 0);
  ok('meals_clients: 50% both years',
    deductiblePctFor('meals_clients', C) === 50 && deductiblePctFor('meals_clients', C26) === 50);
  ok('entertainment: 0% always',
    deductiblePctFor('entertainment', C) === 0 && deductiblePctFor('entertainment', C26) === 0);
  ok('legacy "meals" rows read as client meals (50%)',
    deductiblePctFor('meals', C26) === 50 && normalizeCategory('meals') === 'meals_clients');
  ok('ordinary categories: 100%',
    deductiblePctFor('rent', C26) === 100 && deductiblePctFor('equipment', C26) === 100);
  ok('no constants ⇒ permanent-law defaults (ent 0, staff meals 0, client meals 50, rest 100)',
    deductiblePctFor('entertainment', null) === 0 && deductiblePctFor('meals_staff', null) === 0
    && deductiblePctFor('meals_clients', null) === 50 && deductiblePctFor('supplies', null) === 100);

  console.log('\n— Pure: helpers —');
  ok('category normalize: known passes', normalizeCategory('rent') === 'rent');
  ok('category normalize: unknown ⇒ other', normalizeCategory('zzz') === 'other' && normalizeCategory(null) === 'other');
  ok('quarterOfMonth', quarterOfMonth(1) === 1 && quarterOfMonth(3) === 1 && quarterOfMonth(4) === 2 && quarterOfMonth(12) === 4);
  ok('daysUntil', daysUntil('2026-06-15', '2026-06-10') === 5 && daysUntil('2026-06-01', '2026-06-10') === -9);

  // ── LIVE ──────────────────────────────────────────────────────────────────
  const year = 2026;
  console.log('\n— Live: revenue reconciles to accounting gross definition —');
  const rev = await taxRevenueForRange(db as never, `${year}-01-01`, `${year}-12-31`);
  // Independent recompute of the SAME three streams the accounting panel headlines.
  const toEnd = `${year}-12-31T23:59:59`;
  const [{ data: bk }, { data: beats }, { data: media }] = await Promise.all([
    db.from('bookings').select('total_amount').neq('status', 'cancelled').gte('start_time', `${year}-01-01`).lte('start_time', toEnd),
    db.from('beat_purchases').select('amount_paid').gte('created_at', `${year}-01-01`).lte('created_at', toEnd),
    db.from('media_sales').select('amount').gte('created_at', `${year}-01-01`).lte('created_at', toEnd),
  ]);
  const indep = ((bk ?? []) as any[]).reduce((s, r) => s + (r.total_amount || 0), 0)
    + ((beats ?? []) as any[]).reduce((s, r) => s + (r.amount_paid || 0), 0)
    + ((media ?? []) as any[]).reduce((s, r) => s + (r.amount || 0), 0);
  ok('taxRevenue grossCents == independent recompute (cent-exact)', rev.grossCents === indep, `lib ${rev.grossCents} vs ${indep}`);

  console.log('\n— Live: P&L is coherent + contract labor = staff earnings (work basis) —');
  const pnl = await computePnL(db as never, year);
  ok('P&L revenue top line = gross + kept deposits', pnl.totalRevenueCents === rev.grossCents + rev.keptDepositsCents);
  const ytdPaid = await contractorPaidForRange(db as never, `${year}-01-01`, `${year}-12-31`);
  const ytdEarned = await staffEarningsForRange(db as never, `${year}-01-01`, `${year}-12-31`);
  ok('contract labor line = EXACT staff earnings for the year\'s work (same basis as revenue)',
    pnl.contractLaborCents === ytdEarned, `pnl ${pnl.contractLaborCents} vs ${ytdEarned}`);
  ok('cash payouts ride along as paidOutCents (the 1099 basis)', pnl.paidOutCents === ytdPaid,
    `pnl ${pnl.paidOutCents} vs ${ytdPaid}`);
  ok('net profit = revenue − expenses', pnl.netProfitCents === pnl.totalRevenueCents - pnl.totalExpensesCents);
  ok('no NaN anywhere in P&L', Number.isFinite(pnl.netProfitCents) && Number.isFinite(pnl.contractLaborCents));

  console.log('\n— Live: contractor dashboard (cash counted, sums to total) —');
  const cards = await contractorDashboard(db as never, year);
  ok('contractor cards exist (backfilled payees)', cards.length >= 1);
  const cardsTotal = cards.reduce((s, c) => s + c.ytdPaidCents, 0);
  ok('sum of card YTD == total payouts (every dollar attributed)', cardsTotal === ytdPaid, `cards ${cardsTotal} vs ${ytdPaid}`);
  ok('cash is tracked first-class', cards.every((c) => typeof c.cashCents === 'number'));
  // Year-keyed threshold (OBBBA): 2026 cards flag at $2,000, not $600. A card
  // between the old and new threshold must NOT flag — the law changed.
  ok('YTD over the YEAR\'S threshold trips the 1099 flag',
    cards.filter((c) => !c.isOwner && c.thresholdCents != null && c.ytdPaidCents >= c.thresholdCents).every((c) => c.needs1099));
  ok('between $600 and $2,000 in 2026 ⇒ NO flag (threshold moved)',
    cards.filter((c) => !c.isOwner && c.ytdPaidCents >= 60000 && c.ytdPaidCents < 200000).every((c) => !c.needs1099));

  // Review-fleet critical regression: a payout with contractor_id NULL (e.g. an
  // older write path) must STILL count toward the named contractor's YTD —
  // the merge-safe aggregation sums FK-linked + name-matched-unlinked buckets.
  const target = cards[0];
  const { data: seeded } = await db.from('payroll_payouts').insert({
    person_name: target.displayName, amount: 101, method: 'cash', note: 'tax-test (ignore)',
  } as never).select('id,contractor_id').single();
  try {
    ok('seeded payout is genuinely unlinked', (seeded as { contractor_id: string | null }).contractor_id === null);
    const cards2 = await contractorDashboard(db as never, year);
    const after = cards2.find((c) => c.id === target.id);
    ok('NULL-FK payout still counts toward contractor YTD (+$1.01)',
      (after?.ytdPaidCents ?? 0) === target.ytdPaidCents + 101,
      `before ${target.ytdPaidCents} after ${after?.ytdPaidCents}`);
    ok('and toward the cash column', (after?.cashCents ?? 0) === target.cashCents + 101);
  } finally {
    await db.from('payroll_payouts').delete().eq('id', (seeded as { id: string }).id);
  }

  console.log('\n— Live: estimates compute without NaN; constants gate present —');
  const est = await computeEstimates(db as never, year);
  ok('estimates returned (constants seeded)', est != null && est.quarters.length === 4);
  if (est) {
    ok('every quarter is finite + non-negative', est.quarters.every((q) => Number.isFinite(q.suggestedPaymentCents) && q.suggestedPaymentCents >= 0));
    ok('constants flagged unreviewed (CPA gate honored)', est.reviewed === false);
  }
  const c2026 = await getTaxConstants(db as never, year);
  ok('2026 constants exist + reviewed=false', !!c2026 && c2026.reviewed === false);
  // OBBBA seeds landed in the LIVE rows (085): 2026 threshold $2,000, 2025 $600.
  ok('LIVE 2026 threshold = $2,000 (OBBBA)', c2026?.nineteen99ThresholdCents === 200000,
    String(c2026?.nineteen99ThresholdCents));
  const c2025 = await getTaxConstants(db as never, 2025);
  ok('LIVE 2025 threshold = $600', c2025?.nineteen99ThresholdCents === 60000);
  ok('LIVE 2026 staff meals 0% / 2025 staff meals 50%',
    deductiblePctFor('meals_staff', c2026) === 0 && deductiblePctFor('meals_staff', c2025) === 50);
  ok('LIVE QBI seeds: 20% both years, $400 min only 2026',
    c2026?.qbiPct === 20 && c2026?.qbiMinDeductionCents === 40000
    && c2025?.qbiPct === 20 && c2025?.qbiMinDeductionCents === null);
  // P&L deductible columns are internally consistent.
  ok('P&L: deductible + nondeductible = total expenses',
    pnl.deductibleExpensesCents + pnl.nondeductibleCents === pnl.totalExpensesCents);
  ok('P&L: taxable net = revenue − deductible', pnl.taxableNetCents === pnl.totalRevenueCents - pnl.deductibleExpensesCents);
  ok('P&L: equipment invested == full first-year deduction value (100% bonus)',
    pnl.equipmentInvestedCents === pnl.equipmentDeductionCents);
  ok('a year with no constants ⇒ estimates null (no crash)', (await computeEstimates(db as never, 1999)) === null);

  console.log('\n— Live: actual payments feed the catch-up (owner-audit fix) —');
  // Record a huge Q1 actual payment → later quarters' suggested must collapse
  // to 0 (the math now prefers what was PAID over what was suggested).
  const { data: pay } = await db.from('tax_payments').insert({
    studio_id: null, tax_year: year, quarter: 1, paid_cents: 50_000_000,
    paid_on: `${year}-04-10`, note: 'tax-test (ignore)',
  } as never).select('id').single();
  try {
    const est2 = await computeEstimates(db as never, year);
    ok('Q1 paid amount surfaces on the quarter', est2?.quarters[0].paidCents === 50_000_000);
    ok('massive Q1 payment zeroes later quarters', !!est2 && est2.quarters.slice(1).every((q) => q.suggestedPaymentCents === 0));
  } finally {
    await db.from('tax_payments').delete().eq('id', (pay as { id: string }).id);
  }

  console.log('\n— Live: owner exclusion + no-constants honesty (owner-audit fixes) —');
  const { data: ownerC } = await db.from('contractors').insert({
    studio_id: null, legal_name: 'TAXTEST Owner', display_name: 'TAXTEST Owner', is_owner: true,
  } as never).select('id').single();
  const ownerId = (ownerC as { id: string }).id;
  const { data: ownerPay } = await db.from('payroll_payouts').insert({
    person_name: 'TAXTEST Owner', amount: 12345, method: 'check', note: 'tax-test', contractor_id: ownerId,
  } as never).select('id').single();
  try {
    const labor = await contractorPaidForRange(db as never, `${year}-01-01`, `${year}-12-31`);
    const laborBefore = ytdPaid; // from earlier in the test, before owner payout existed
    ok('owner payouts EXCLUDED from contract labor', labor === laborBefore, `now ${labor} vs ${laborBefore}`);
    const cards3 = await contractorDashboard(db as never, year);
    const ownerCard = cards3.find((c) => c.id === ownerId);
    ok('owner card flagged owner + never needs 1099', ownerCard?.flag === 'owner' && ownerCard?.needs1099 === false);
    ok('owner pay still VISIBLE on their card', ownerCard?.ytdPaidCents === 12345);
    const cards1999 = await contractorDashboard(db as never, 1999);
    ok('constants-less year ⇒ flag no_constants, never a false "under $600"',
      cards1999.filter((c) => !c.isOwner).every((c) => c.flag === 'no_constants'));
  } finally {
    await db.from('payroll_payouts').delete().eq('id', (ownerPay as { id: string }).id);
    await db.from('contractors').delete().eq('id', ownerId);
  }

  console.log('\n— Live (v2): cross-year range applies each ROW\'S year rules —');
  // Staff meals: 50% in 2025, 0% in 2026. A Dec-2025 + Jan-2026 pair inside one
  // range must deduct 50% + 0% — not the from-year's rule for both.
  const { data: x25 } = await db.from('business_expenses').insert({
    studio_id: null, category: 'meals_staff', description: 'tax-test xyear 2025',
    amount_cents: 10000, incurred_on: '2025-12-15',
  } as never).select('id').single();
  const { data: x26 } = await db.from('business_expenses').insert({
    studio_id: null, category: 'meals_staff', description: 'tax-test xyear 2026',
    amount_cents: 10000, incurred_on: '2026-01-15',
  } as never).select('id').single();
  try {
    const xp = await (await import('../lib/tax-server')).computePnLRange(db as never, '2025-12-01', '2026-01-31');
    const staffCat = xp.expensesByCategory.find((c) => c.key === 'meals_staff');
    ok('cross-year staff meals: $100 (2025) + $100 (2026) ⇒ deductible exactly $50',
      (staffCat?.amountCents ?? 0) >= 20000 && (staffCat?.deductibleCents ?? -1) === 5000,
      `amount ${staffCat?.amountCents} deductible ${staffCat?.deductibleCents}`);
  } finally {
    await db.from('business_expenses').delete().in('id', [(x25 as any).id, (x26 as any).id]);
  }
  // 3+-year range: a MIDDLE-year row (2026) must use 2026 rules even when the
  // range starts in 2025 and ends in 2027 (an unseeded year).
  const { data: xm } = await db.from('business_expenses').insert({
    studio_id: null, category: 'meals_staff', description: 'tax-test midyear 2026',
    amount_cents: 10000, incurred_on: '2026-06-01',
  } as never).select('id').single();
  try {
    const xp3 = await (await import('../lib/tax-server')).computePnLRange(db as never, '2025-01-01', '2027-01-31');
    const cat3 = xp3.expensesByCategory.find((c) => c.key === 'meals_staff');
    // The seeded mid-year $100 contributes $0 deductible (2026 rule), and any
    // unseeded-2027 rows would too (permanent-law default).
    ok('3-year range: middle-year (2026) staff meal deducts $0 (own-year rule)',
      (cat3?.deductibleCents ?? -1) === 0, `deductible ${cat3?.deductibleCents}`);
  } finally {
    await db.from('business_expenses').delete().eq('id', (xm as any).id);
  }

  console.log('\n— Live: recurring expense materializer (owner-audit fix) —');
  const { data: tpl } = await db.from('recurring_expense_templates').insert({
    studio_id: null, label: 'TAXTEST monthly rent', category: 'rent', amount_cents: 99901, day_of_month: 1, active: true,
  } as never).select('id').single();
  const tplId = (tpl as { id: string }).id;
  try {
    const r1 = await materializeRecurringExpenses(db as never);
    ok('materializer creates the month\'s expense', r1.created >= 1);
    const { data: made } = await db.from('business_expenses').select('id,amount_cents,recurring_template_id')
      .eq('recurring_template_id', tplId).is('deleted_at', null);
    ok('expense row linked to the template + right amount',
      (made ?? []).length === 1 && (made as any[])[0].amount_cents === 99901);
    const r2 = await materializeRecurringExpenses(db as never);
    const { data: made2 } = await db.from('business_expenses').select('id').eq('recurring_template_id', tplId).is('deleted_at', null);
    ok('second run is a no-op (idempotent per month)', (made2 ?? []).length === 1 && r2.created === 0);
  } finally {
    await db.from('business_expenses').delete().eq('recurring_template_id', tplId);
    await db.from('recurring_expense_templates').delete().eq('id', tplId);
  }
}

main()
  .catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); fail++; })
  .finally(() => {
    console.log(`\n${fail === 0 ? '✅ TAX CENTER: ALL PASS' : `❌ ${fail} FAILED: ${failures.join(', ')}`}  (${pass} passed)\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
