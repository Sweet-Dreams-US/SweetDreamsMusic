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
  type TaxConstants,
} from '../lib/tax';
import {
  taxRevenueForRange, computePnL, contractorDashboard, computeEstimates,
  contractorPaidForRange, getTaxConstants,
} from '../lib/tax-server';

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
const C: TaxConstants = {
  taxYear: 2026, seNetFactor: 0.9235, seTaxRate: 0.1530,
  ssWageBaseCents: 18420000, ssRate: 0.1240, medicareRate: 0.0290,
  nineteen99ThresholdCents: 60000,
  dueDates: { '1': '2026-04-15', '2': '2026-06-15', '3': '2026-09-15', '4': '2027-01-15' },
  reviewed: false,
};

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
      entityType: 's_corp', incomeTaxRatePct: 20, constants: C, priorSuggestedCents: prior,
    });
    ok(`Q${q} suggested = $2,000`, est.suggestedPaymentCents === expected[q - 1],
      `got ${est.suggestedPaymentCents}`);
    prior += est.suggestedPaymentCents;
  }
  // Flat income (no growth after Q1) ⇒ later quarters ask for $0, never negative.
  const flatQ2 = computeQuarterlyEstimate({
    ytdRevenueCents: 4_000_000, ytdExpensesCents: 0, entityType: 's_corp',
    incomeTaxRatePct: 20, constants: C, priorSuggestedCents: 800000, // Q1 already suggested 20% of 40k
  });
  ok('no income growth ⇒ $0 this quarter (never negative)', flatQ2.suggestedPaymentCents === 0,
    `got ${flatQ2.suggestedPaymentCents}`);

  console.log('\n— Pure: 1099 threshold ($600 = 60000 cents) —');
  ok('$599.99 ⇒ no 1099', !needs1099(59999, C));
  ok('exactly $600.00 ⇒ 1099 required', needs1099(60000, C));
  ok('$600.01 ⇒ 1099 required', needs1099(60001, C));
  ok('over threshold + no W-9 ⇒ loud flag', contractorCompliance({ ytdPaidCents: 60000, hasW9: false, constants: C }).flag === 'needs_1099_missing_w9');
  ok('over threshold + W-9 ⇒ needs_1099', contractorCompliance({ ytdPaidCents: 60000, hasW9: true, constants: C }).flag === 'needs_1099');
  ok('under threshold ⇒ below_threshold', contractorCompliance({ ytdPaidCents: 1, hasW9: false, constants: C }).flag === 'below_threshold');

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

  console.log('\n— Live: P&L is coherent + contract labor auto-fed —');
  const pnl = await computePnL(db as never, year);
  ok('P&L revenue top line = gross + kept deposits', pnl.totalRevenueCents === rev.grossCents + rev.keptDepositsCents);
  const ytdPaid = await contractorPaidForRange(db as never, `${year}-01-01`, `${year}-12-31`);
  ok('contract labor line = actual payroll_payouts total', pnl.contractLaborCents === ytdPaid, `pnl ${pnl.contractLaborCents} vs ${ytdPaid}`);
  ok('net profit = revenue − expenses', pnl.netProfitCents === pnl.totalRevenueCents - pnl.totalExpensesCents);
  ok('no NaN anywhere in P&L', Number.isFinite(pnl.netProfitCents) && Number.isFinite(pnl.contractLaborCents));

  console.log('\n— Live: contractor dashboard (cash counted, sums to total) —');
  const cards = await contractorDashboard(db as never, year);
  ok('contractor cards exist (backfilled payees)', cards.length >= 1);
  const cardsTotal = cards.reduce((s, c) => s + c.ytdPaidCents, 0);
  ok('sum of card YTD == total payouts (every dollar attributed)', cardsTotal === ytdPaid, `cards ${cardsTotal} vs ${ytdPaid}`);
  ok('cash is tracked first-class', cards.every((c) => typeof c.cashCents === 'number'));
  ok('YTD over $600 trips the 1099 flag', cards.filter((c) => c.ytdPaidCents >= 60000).every((c) => c.needs1099));

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
  ok('a year with no constants ⇒ estimates null (no crash)', (await computeEstimates(db as never, 1999)) === null);
}

main()
  .catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); fail++; })
  .finally(() => {
    console.log(`\n${fail === 0 ? '✅ TAX CENTER: ALL PASS' : `❌ ${fail} FAILED: ${failures.join(', ')}`}  (${pass} passed)\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
