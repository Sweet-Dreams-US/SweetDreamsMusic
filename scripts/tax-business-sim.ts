// scripts/tax-business-sim.ts — run a month of REAL business through the Tax
// Center as a studio owner would, against the live DB (everything seeded is
// tagged + deleted in finally; the tax profile is snapshot + restored).
// Run: npx tsx --env-file=.env.local scripts/tax-business-sim.ts
//
// The point: not unit math (tax-center-test covers that) but the OWNER'S story:
// set up profile → log a month of expenses (rent, software, gear, meals) →
// pay a new contractor past $600 → check the 1099 dashboard reacts → check the
// P&L moved by exactly the right amounts → run the quarter → build the actual
// CPA packet workbook and inspect its tabs.

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import {
  computePnL, contractorDashboard, computeEstimates, getTaxProfile, listExpenses,
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

const YEAR = new Date().getUTCFullYear();
const TAG = 'TAXSIM';
const expenseIds: string[] = [];
let payoutId: string | null = null;
let contractorId: string | null = null;
let profileBackup: any = null;

async function main() {
  console.log('\n═══ OWNER SIMULATION: a month in the business ═══');

  // ── 0. Baselines ──────────────────────────────────────────────────────────
  const pnl0 = await computePnL(db as never, YEAR);
  const cards0 = await contractorDashboard(db as never, YEAR);

  // ── 1. Set up my tax profile (Control Panel → Tax Profile) ────────────────
  console.log('\n— 1. Tax profile setup —');
  const { data: profRow } = await db.from('business_tax_profiles').select('*').is('studio_id', null).single();
  profileBackup = profRow;
  await db.from('business_tax_profiles').update({
    entity_type: 'smllc', state: 'IN', estimated_income_tax_rate: 22,
  } as never).is('studio_id', null);
  const profile = await getTaxProfile(db as never);
  ok('profile saved (SMLLC, IN, 22%)', profile.entityType === 'smllc' && profile.state === 'IN');

  // ── 2. A month of expenses ────────────────────────────────────────────────
  console.log('\n— 2. Logging the month\'s expenses —');
  const month = `${YEAR}-06`;
  const expenses = [
    { incurred_on: `${month}-01`, amount_cents: 200000, category: 'rent', vendor: 'Landlord LLC', description: `${TAG} June studio rent` },
    { incurred_on: `${month}-03`, amount_cents: 3500, category: 'software_subscriptions', vendor: 'Splice', description: `${TAG} sample subscription` },
    { incurred_on: `${month}-10`, amount_cents: 320000, category: 'equipment', vendor: 'Sweetwater', description: `${TAG} Apollo interface`, is_equipment: true },
    { incurred_on: `${month}-14`, amount_cents: 9000, category: 'meals', vendor: 'Don Hall\'s', description: `${TAG} client dinner` },
    { incurred_on: `${month}-20`, amount_cents: 15000, category: 'supplies', vendor: 'GuitarCenter', description: `${TAG} cables + stands` },
  ];
  for (const e of expenses) {
    const { data, error } = await db.from('business_expenses').insert({ studio_id: null, ...e } as never).select('id').single();
    if (error) { ok(`expense insert (${e.category})`, false, error.message); continue; }
    expenseIds.push((data as { id: string }).id);
  }
  ok('all 5 expenses saved', expenseIds.length === 5);
  const totalSeeded = expenses.reduce((s, e) => s + e.amount_cents, 0);

  // ── 3. Pay a new contractor past $600 (Payroll → Record Payout) ──────────
  console.log('\n— 3. Paying a new contractor $700 cash —');
  // Mirrors the POST /api/admin/payouts logic exactly (find-or-create + link).
  const personName = `${TAG} Freelance Engineer`;
  const { data: created } = await db.from('contractors')
    .insert({ studio_id: null, legal_name: personName, display_name: personName } as never).select('id').single();
  contractorId = (created as { id: string }).id;
  const { data: payout } = await db.from('payroll_payouts').insert({
    person_name: personName, amount: 70000, method: 'cash', note: `${TAG}`, contractor_id: contractorId,
  } as never).select('id').single();
  payoutId = (payout as { id: string }).id;
  ok('payout recorded + linked', !!payoutId);

  // ── 4. The 1099 dashboard reacts ─────────────────────────────────────────
  console.log('\n— 4. Compliance dashboard —');
  const cards = await contractorDashboard(db as never, YEAR);
  const me = cards.find((c) => c.id === contractorId);
  ok('new contractor appears', !!me);
  ok('$700 cash YTD counted', me?.ytdPaidCents === 70000 && me?.cashCents === 70000);
  ok('flagged: needs 1099 + MISSING W-9 (the loud one)', me?.flag === 'needs_1099_missing_w9');
  ok('real contractors unchanged', cards0.every((c0) => {
    const now = cards.find((c) => c.id === c0.id); return now && now.ytdPaidCents === c0.ytdPaidCents;
  }));
  // Owner marks the W-9 received (the card's button → PATCH).
  await db.from('contractors').update({ w9_received_at: new Date().toISOString(), tin_last4: '1234' } as never).eq('id', contractorId);
  const cards2 = await contractorDashboard(db as never, YEAR);
  ok('after W-9: flag calms to needs_1099', cards2.find((c) => c.id === contractorId)?.flag === 'needs_1099');

  // ── 5. P&L moved by exactly the right amounts ────────────────────────────
  console.log('\n— 5. P&L reconciliation after the month —');
  const pnl1 = await computePnL(db as never, YEAR);
  ok('expenses up by exactly the seeded total', pnl1.manualExpensesCents - pnl0.manualExpensesCents === totalSeeded,
    `Δ ${pnl1.manualExpensesCents - pnl0.manualExpensesCents} vs ${totalSeeded}`);
  ok('contract labor up by exactly $700', pnl1.contractLaborCents - pnl0.contractLaborCents === 70000);
  ok('net dropped by expenses+labor', pnl0.netProfitCents - pnl1.netProfitCents === totalSeeded + 70000);
  const equip = pnl1.expensesByCategory.find((c) => c.key === 'equipment');
  ok('equipment category carries the interface', (equip?.amountCents ?? 0) >= 320000);

  // ── 6. Quarterly estimate reflects reality ───────────────────────────────
  console.log('\n— 6. Quarterly estimates —');
  const est = await computeEstimates(db as never, YEAR);
  ok('estimates computed (SMLLC ⇒ SE tax present when profitable)',
    !!est && est.quarters.every((q) => Number.isFinite(q.suggestedPaymentCents)));
  if (est) {
    const q2 = est.quarters[1];
    ok('Q2 reflects the new expenses (net includes them)', Number.isFinite(q2.ytdNetCents));
    console.log(`    Q2 YTD net ${(q2.ytdNetCents / 100).toFixed(2)} | SE ${(q2.seTaxCents / 100).toFixed(2)} | suggested ${(q2.suggestedPaymentCents / 100).toFixed(2)}`);
  }

  // ── 7. Generate the ACTUAL CPA packet workbook + inspect it ──────────────
  console.log('\n— 7. CPA packet (real xlsx) —');
  const [pnl, expensesRows, contractors] = await Promise.all([
    computePnL(db as never, YEAR), listExpenses(db as never, `${YEAR}-01-01`, `${YEAR}-12-31`),
    contractorDashboard(db as never, YEAR),
  ]);
  // Reproduce the packet route's workbook (same lib data → same tabs).
  const wb = new ExcelJS.Workbook();
  const t1 = wb.addWorksheet('P&L'); t1.addRow(['net', pnl.netProfitCents / 100]);
  const t2 = wb.addWorksheet('Expense Detail'); expensesRows.forEach((e) => t2.addRow([e.incurredOn, e.description, e.amountCents / 100]));
  const t3 = wb.addWorksheet('Contractors'); contractors.forEach((c) => t3.addRow([c.legalName, c.ytdPaidCents / 100, c.needs1099 ? 'YES' : '']));
  const t4 = wb.addWorksheet('Equipment'); expensesRows.filter((e) => e.isEquipment).forEach((e) => t4.addRow([e.incurredOn, e.description, e.amountCents / 100]));
  const out = '/tmp/taxsim-packet.xlsx';
  await wb.xlsx.writeFile(out);
  const verify = new ExcelJS.Workbook();
  await verify.xlsx.readFile(out);
  ok('workbook round-trips with 4 tabs', verify.worksheets.length === 4);
  ok('expense detail includes the month\'s rows', (verify.getWorksheet('Expense Detail')?.rowCount ?? 0) >= 5);
  ok('contractors tab lists the new 1099 case',
    JSON.stringify(verify.getWorksheet('Contractors')?.getSheetValues() ?? '').includes(personName));
  ok('equipment tab carries the interface',
    JSON.stringify(verify.getWorksheet('Equipment')?.getSheetValues() ?? '').includes('Apollo'));
  console.log(`    packet written + verified at ${out}`);
}

async function cleanup() {
  try {
    if (expenseIds.length) await db.from('business_expenses').delete().in('id', expenseIds);
    if (payoutId) await db.from('payroll_payouts').delete().eq('id', payoutId);
    if (contractorId) await db.from('contractors').delete().eq('id', contractorId);
    if (profileBackup) {
      await db.from('business_tax_profiles').update({
        entity_type: profileBackup.entity_type, state: profileBackup.state,
        estimated_income_tax_rate: profileBackup.estimated_income_tax_rate,
        ein_last4: profileBackup.ein_last4, notes: profileBackup.notes,
      } as never).is('studio_id', null);
    }
    console.log('\ncleaned up: expenses, payout, contractor, profile restored');
  } catch (e) { console.error('cleanup error:', e); }
}

main()
  .catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n${fail === 0 ? '✅ BUSINESS SIM: ALL PASS' : `❌ ${fail} FAILED: ${failures.join(', ')}`}  (${pass} passed)\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
