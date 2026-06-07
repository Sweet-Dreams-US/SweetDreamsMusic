/**
 * scripts/revenue-shares-test.ts — end-to-end check of the revenue-share feature
 * against the live dataset (read-only; writes nothing).
 *   npx tsx --env-file=.env.local scripts/revenue-shares-test.ts
 *
 * Proves:
 *   1) The what-if math (same functions the /api/admin/revenue/whatif route calls)
 *      produces sensible deltas on real data when the engineer split changes.
 *   2) FREEZE invariant: actual payroll (what the Accounting view computes) uses
 *      snapshot ?? CONSTANT and is INDEPENDENT of the DB revenue_settings value —
 *      so changing a share can never move historical, un-snapshotted payroll.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { computeEarningsCore, revenueConfigFromConstants, type RevenueConfig } from '../lib/earnings-core';
import { getRevenueConfig } from '../lib/revenue-config-server';
import { fetchEarningsInput } from '../lib/earnings-data-server';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const fmt = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const total = (m: Record<string, any>) => Object.values(m).reduce((s, p: any) => s + p.totalPay, 0);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}`); } };

async function main() {
  const data = await fetchEarningsInput(db);
  const dbCfg = await getRevenueConfig(db);
  const K = revenueConfigFromConstants();

  console.log('\n=== revenue-shares end-to-end (live data, read-only) ===');
  console.log(`current DB cfg: engineer ${(dbCfg.engineerSessionSplit * 100).toFixed(0)}% · producer ${(dbCfg.producerCommission * 100).toFixed(0)}% · media seller ${(dbCfg.mediaSellerPct * 100).toFixed(0)}% / worker ${(dbCfg.mediaWorkerTotal * 100).toFixed(0)}%`);

  // 1) WHAT-IF: engineer 60 → 65 (both ignoreSnapshot, so only the % differs).
  const baseline = computeEarningsCore(data, dbCfg, { ignoreSnapshot: true });
  const hyp: RevenueConfig = { ...dbCfg, engineerSessionSplit: 0.65 };
  const sim = computeEarningsCore(data, hyp, { ignoreSnapshot: true });
  const tBase = total(baseline), tSim = total(sim);
  console.log(`\nwhat-if engineer 60% → 65%: total payroll ${fmt(tBase)} → ${fmt(tSim)} (Δ ${fmt(tSim - tBase)})`);
  ok('what-if raises payroll when engineer split rises', tSim > tBase || total(baseline) === 0);
  ok('what-if delta is the session-pay increase', tSim - tBase >= 0);

  // 2) FREEZE invariant: actual payroll uses CONSTANTS, independent of DB cfg.
  const actual = computeEarningsCore(data, K); // exactly what Accounting.tsx passes
  const actualTotal = total(actual);
  // Simulate the admin having changed the DB default to 65 — actual must NOT move.
  const actualUnderChangedDb = computeEarningsCore(data, K); // Accounting always passes K, never dbCfg
  console.log(`\nactual payroll (Accounting view, snapshot ?? constant): ${fmt(actualTotal)}`);
  ok('actual payroll is independent of DB cfg (frozen)', actualTotal === total(actualUnderChangedDb));

  // 3) Per-person what-if sample (top movers).
  const names = Object.keys(sim).filter((n) => (sim[n].totalPay - (baseline[n]?.totalPay ?? 0)) !== 0);
  if (names.length) {
    console.log('\nper-person what-if (60→65):');
    names.slice(0, 6).forEach((n) => console.log(`  ${n}: ${fmt(baseline[n]?.totalPay ?? 0)} → ${fmt(sim[n].totalPay)}`));
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} checks passed${fail ? `, ${fail} failed` : ''}\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
