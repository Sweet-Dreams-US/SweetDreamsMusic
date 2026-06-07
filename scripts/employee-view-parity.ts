// scripts/employee-view-parity.ts
//
// Proves the EMPLOYEE self-views now net to the EXACT same cents as the
// authoritative admin payroll (computeEarningsCore), on the live dataset.
//
//   • Engineer self-view (EngineerAccounting.tsx) session pay formula
//       sum(round((service_value_cents ?? total_amount) * (engineer_split_pct/100 ?? 60%)))
//     must equal computeEarningsCore[eng].sessionPay
//   • Producer self-view (/api/producer/earnings) beat-net formula
//       sum(round(amount_paid * (producer_pct/100 ?? 60%)))
//     must equal computeEarningsCore[prod].beatProducerPay
//   • Engineer media seller commission (per-row seller_pct ?? 15%) must equal
//     the seller portion computeEarningsCore attributes from sold_by rows.
//
// This is the #40 go-live gate: with no snapshots/overrides today the views were
// already correct; this proves the REFACTORED per-row math is byte-identical to
// the admin source of truth (so a future share edit can't desync them).

import { createServiceClient } from '../lib/supabase/server';
import { fetchEarningsInput } from '../lib/earnings-data-server';
import { computeEarningsCore, revenueConfigFromConstants, normalizeName } from '../lib/earnings-core';
import { ENGINEER_SESSION_SPLIT, PRODUCER_COMMISSION, MEDIA_SELLER_COMMISSION } from '../lib/constants';

function ok(label: string, a: number, b: number) {
  const pass = a === b;
  console.log(`${pass ? '✅' : '❌'} ${label}: view=${a}  admin=${b}${pass ? '' : `  DELTA=${a - b}`}`);
  return pass;
}

async function main() {
  const db = createServiceClient();
  const input = await fetchEarningsInput(db);
  const admin = computeEarningsCore(input, revenueConfigFromConstants());

  let allPass = true;

  // ── Engineer self-view: per-row session pay (value-based, snapshot ?? const) ──
  const viewSessionPay: Record<string, number> = {};
  for (const b of input.bookings) {
    if (b.status !== 'completed') continue;
    const eng = normalizeName(b.engineer_name);
    if (!eng || eng === 'Unassigned') continue;
    const frac = b.engineer_split_pct != null ? Number(b.engineer_split_pct) / 100 : ENGINEER_SESSION_SPLIT;
    const value = b.service_value_cents ?? b.total_amount;
    viewSessionPay[eng] = (viewSessionPay[eng] ?? 0) + Math.round(value * frac);
  }
  console.log('— Engineer self-view session pay vs admin —');
  for (const eng of Object.keys(admin)) {
    if (admin[eng].sessionPay === 0 && !(eng in viewSessionPay)) continue;
    if (!ok(`  ${eng} sessionPay`, viewSessionPay[eng] ?? 0, admin[eng].sessionPay)) allPass = false;
  }

  // ── Engineer self-view: media seller commission (per-row seller_pct ?? const) ──
  // Compare against admin's seller attribution from sold_by rows only.
  const viewSellerComm: Record<string, number> = {};
  for (const m of input.media) {
    const seller = normalizeName(m.sold_by);
    if (!seller) continue;
    const frac = m.seller_pct != null ? Number(m.seller_pct) / 100 : MEDIA_SELLER_COMMISSION;
    viewSellerComm[seller] = (viewSellerComm[seller] ?? 0) + Math.round(m.amount * frac);
  }
  console.log('— Engineer self-view media seller commission vs admin —');
  for (const seller of Object.keys(viewSellerComm)) {
    if (!ok(`  ${seller} mediaCommission`, viewSellerComm[seller], admin[seller]?.mediaCommission ?? 0)) allPass = false;
  }

  // ── Producer self-view: beat net (per-row producer_pct ?? const) ──
  const viewBeatPay: Record<string, number> = {};
  for (const p of input.beats) {
    const prod = normalizeName((p.beats as { producer: string | null } | null)?.producer ?? null);
    if (!prod) continue;
    const frac = p.producer_pct != null ? Number(p.producer_pct) / 100 : PRODUCER_COMMISSION;
    viewBeatPay[prod] = (viewBeatPay[prod] ?? 0) + Math.round(p.amount_paid * frac);
  }
  console.log('— Producer self-view beat net vs admin —');
  const prodNames = new Set([...Object.keys(viewBeatPay), ...Object.keys(admin).filter((k) => admin[k].beatProducerPay > 0)]);
  if (prodNames.size === 0) console.log('  (no beat sales in dataset — vacuously consistent)');
  for (const prod of prodNames) {
    if (!ok(`  ${prod} beatProducerPay`, viewBeatPay[prod] ?? 0, admin[prod]?.beatProducerPay ?? 0)) allPass = false;
  }

  console.log('');
  console.log(allPass ? '✅ ALL EMPLOYEE VIEWS MATCH ADMIN PAYROLL (cent-exact)' : '❌ MISMATCH — employee views diverge from admin');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
