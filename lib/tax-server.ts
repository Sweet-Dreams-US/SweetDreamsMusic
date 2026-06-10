// lib/tax-server.ts — DB layer for the Tax Center (Plan 5).
//
// Client-injected db (no next/headers) so routes AND tsx scripts share it.
// Callers pass the SERVICE client; routes gate admin first. All cents.
//
// REVENUE RECONCILIATION: taxRevenueForRange mirrors /api/admin/accounting's
// gross-revenue definition EXACTLY (bookings.total_amount non-cancelled by
// start_time + beat_purchases.amount_paid by created_at + media_sales.amount by
// created_at), so the Tax Center P&L ties to the accounting panel to the cent.
// Kept deposits + Hub media orders + packages are reported as SEPARATE,
// explicitly-labeled lines (the panel keeps them out of headline gross too).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EXPENSE_CATEGORIES, normalizeCategory, computeQuarterlyEstimate,
  contractorCompliance, quarterMonthRange,
  type EntityType, type TaxConstants, type QuarterlyEstimate,
} from '@/lib/tax';
import { normalizeName } from '@/lib/earnings-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

// ── tax profile + constants ──────────────────────────────────────────────────

export interface TaxProfile {
  entityType: EntityType;
  einLast4: string | null;
  state: string | null;
  fiscalYearStartMonth: number;
  estimatedIncomeTaxRatePct: number;
  notes: string | null;
}

const DEFAULT_PROFILE: TaxProfile = {
  entityType: 'sole_prop', einLast4: null, state: null,
  fiscalYearStartMonth: 1, estimatedIncomeTaxRatePct: 22, notes: null,
};

export async function getTaxProfile(db: Client): Promise<TaxProfile> {
  const { data } = await db.from('business_tax_profiles')
    .select('*').is('studio_id', null).maybeSingle();
  if (!data) return { ...DEFAULT_PROFILE };
  const r = data as any;
  return {
    entityType: r.entity_type, einLast4: r.ein_last4 ?? null, state: r.state ?? null,
    fiscalYearStartMonth: r.fiscal_year_start_month ?? 1,
    estimatedIncomeTaxRatePct: Number(r.estimated_income_tax_rate ?? 22),
    notes: r.notes ?? null,
  };
}

export async function getTaxConstants(db: Client, year: number): Promise<TaxConstants | null> {
  const { data } = await db.from('tax_constants').select('*').eq('tax_year', year).maybeSingle();
  if (!data) return null;
  const r = data as any;
  return {
    taxYear: r.tax_year,
    seNetFactor: Number(r.se_net_factor),
    seTaxRate: Number(r.se_tax_rate),
    ssWageBaseCents: Number(r.ss_wage_base_cents),
    ssRate: Number(r.ss_rate),
    medicareRate: Number(r.medicare_rate),
    nineteen99ThresholdCents: Number(r.nineteen99_threshold_cents),
    dueDates: r.due_dates ?? {},
    reviewed: !!r.reviewed,
  };
}

// ── revenue (reconciles to the accounting panel) ─────────────────────────────

export interface RevenueBreakdown {
  sessionsCents: number;      // non-cancelled bookings.total_amount, by start_time
  beatsCents: number;         // beat_purchases.amount_paid, by created_at
  mediaSalesCents: number;    // media_sales.amount, by created_at
  grossCents: number;         // the three above — matches accounting "Gross Revenue (All)"
  keptDepositsCents: number;  // cancelled bookings' actual_deposit_paid (separate line)
  hubMediaCents: number;      // media_bookings final_price_cents collected (separate line)
}

export async function taxRevenueForRange(db: Client, fromIso: string, toIso: string): Promise<RevenueBreakdown> {
  const toEnd = `${toIso}T23:59:59`;
  const [bk, beats, media, cancelled, hub] = await Promise.all([
    db.from('bookings').select('total_amount').neq('status', 'cancelled')
      .gte('start_time', fromIso).lte('start_time', toEnd),
    db.from('beat_purchases').select('amount_paid').gte('created_at', fromIso).lte('created_at', toEnd),
    db.from('media_sales').select('amount').gte('created_at', fromIso).lte('created_at', toEnd),
    db.from('bookings').select('actual_deposit_paid').eq('status', 'cancelled')
      .gte('start_time', fromIso).lte('start_time', toEnd),
    db.from('media_bookings').select('actual_deposit_paid,final_paid_at').eq('is_test', false)
      .gte('created_at', fromIso).lte('created_at', toEnd),
  ]);
  const sum = (rows: any[] | null, k: string) => (rows ?? []).reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const sessionsCents = sum(bk.data, 'total_amount');
  const beatsCents = sum(beats.data, 'amount_paid');
  const mediaSalesCents = sum(media.data, 'amount');
  return {
    sessionsCents, beatsCents, mediaSalesCents,
    grossCents: sessionsCents + beatsCents + mediaSalesCents,
    keptDepositsCents: sum(cancelled.data, 'actual_deposit_paid'),
    hubMediaCents: sum(hub.data, 'actual_deposit_paid'),
  };
}

// ── expenses + P&L ───────────────────────────────────────────────────────────

export interface ExpenseRow {
  id: string; incurredOn: string; amountCents: number; vendor: string | null;
  category: string; description: string; isEquipment: boolean;
  receiptStoragePath: string | null; notes: string | null;
}

export async function listExpenses(db: Client, fromIso: string, toIso: string): Promise<ExpenseRow[]> {
  const { data } = await db.from('business_expenses').select('*')
    .is('deleted_at', null).gte('incurred_on', fromIso).lte('incurred_on', toIso)
    .order('incurred_on', { ascending: false });
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, incurredOn: r.incurred_on, amountCents: r.amount_cents,
    vendor: r.vendor ?? null, category: normalizeCategory(r.category),
    description: r.description, isEquipment: !!r.is_equipment,
    receiptStoragePath: r.receipt_storage_path ?? null, notes: r.notes ?? null,
  }));
}

/** Total ACTUAL contractor pay in a window (payroll_payouts, all methods incl. cash). */
export async function contractorPaidForRange(db: Client, fromIso: string, toIso: string): Promise<number> {
  const { data } = await db.from('payroll_payouts').select('amount,created_at')
    .gte('created_at', fromIso).lte('created_at', `${toIso}T23:59:59`);
  return ((data ?? []) as any[]).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

export interface PnL {
  year: number;
  revenue: RevenueBreakdown;
  totalRevenueCents: number;          // gross + kept deposits (the P&L top line)
  expensesByCategory: { key: string; label: string; scheduleCLine: string; amountCents: number }[];
  contractLaborCents: number;         // auto-fed from payroll_payouts — never double-entered
  manualExpensesCents: number;        // business_expenses excluding any 'contract_labor' rows
  totalExpensesCents: number;
  netProfitCents: number;
}

/**
 * Year P&L. Contract labor is auto-filled from payroll_payouts (actual pay), so
 * the contract_labor expense category is IGNORED on manual rows to avoid double
 * counting (the UI tells the admin not to hand-enter payouts).
 */
export async function computePnL(db: Client, year: number): Promise<PnL> {
  const { from, to } = yearRange(year);
  const [revenue, expenses, contractLaborCents] = await Promise.all([
    taxRevenueForRange(db, from, to),
    listExpenses(db, from, to),
    contractorPaidForRange(db, from, to),
  ]);

  const byCat = new Map<string, number>();
  let manualExpensesCents = 0;
  for (const e of expenses) {
    if (e.category === 'contract_labor') continue; // auto-fed below; never double-count
    byCat.set(e.category, (byCat.get(e.category) || 0) + e.amountCents);
    manualExpensesCents += e.amountCents;
  }
  byCat.set('contract_labor', contractLaborCents);

  const expensesByCategory = EXPENSE_CATEGORIES
    .map((c) => ({ key: c.key, label: c.label, scheduleCLine: c.scheduleCLine, amountCents: byCat.get(c.key) || 0 }))
    .filter((c) => c.amountCents > 0);

  const totalRevenueCents = revenue.grossCents + revenue.keptDepositsCents;
  const totalExpensesCents = manualExpensesCents + contractLaborCents;
  return {
    year, revenue, totalRevenueCents, expensesByCategory,
    contractLaborCents, manualExpensesCents, totalExpensesCents,
    netProfitCents: totalRevenueCents - totalExpensesCents,
  };
}

// ── contractor compliance ────────────────────────────────────────────────────

export interface ContractorCard {
  id: string; legalName: string; displayName: string; businessName: string | null;
  hasW9: boolean; w9ReceivedAt: string | null; tinLast4: string | null;
  ytdPaidCents: number; needs1099: boolean; flag: string;
  methods: string[]; cashCents: number;
}

/** Per-contractor YTD payments (ALL methods incl. cash) + 1099 status. */
export async function contractorDashboard(db: Client, year: number): Promise<ContractorCard[]> {
  const { from, to } = yearRange(year);
  const constants = await getTaxConstants(db, year);
  const [{ data: contractors }, { data: payouts }] = await Promise.all([
    db.from('contractors').select('*').eq('active', true),
    db.from('payroll_payouts').select('contractor_id,person_name,amount,method')
      .gte('created_at', from).lte('created_at', `${to}T23:59:59`),
  ]);

  // Roll YTD pay up to a contractor: prefer the FK, fall back to name-normalized
  // match (older rows / manual entries). Cash is tracked first-class.
  const byContractor = new Map<string, { total: number; cash: number; methods: Set<string> }>();
  const byName = new Map<string, { total: number; cash: number; methods: Set<string> }>();
  for (const p of (payouts ?? []) as any[]) {
    const amt = Number(p.amount) || 0;
    const bucket = (m: Map<string, any>, key: string) => {
      if (!m.has(key)) m.set(key, { total: 0, cash: 0, methods: new Set<string>() });
      const b = m.get(key); b.total += amt; if (p.method === 'cash') b.cash += amt; b.methods.add(p.method); return b;
    };
    if (p.contractor_id) bucket(byContractor, p.contractor_id);
    bucket(byName, normalizeName(String(p.person_name || '')) ?? '');
  }

  return ((contractors ?? []) as any[]).map((c) => {
    const agg = byContractor.get(c.id) ?? byName.get(normalizeName(String(c.display_name || c.legal_name || '')) ?? '')
      ?? { total: 0, cash: 0, methods: new Set<string>() };
    const hasW9 = !!c.w9_storage_path || !!c.w9_received_at;
    const comp = constants
      ? contractorCompliance({ ytdPaidCents: agg.total, hasW9, constants })
      : { needs1099: false, flag: 'below_threshold' };
    return {
      id: c.id, legalName: c.legal_name, displayName: c.display_name || c.legal_name,
      businessName: c.business_name ?? null, hasW9, w9ReceivedAt: c.w9_received_at ?? null,
      tinLast4: c.tin_last4 ?? null, ytdPaidCents: agg.total,
      needs1099: comp.needs1099, flag: comp.flag,
      methods: Array.from(agg.methods), cashCents: agg.cash,
    };
  }).sort((a, b) => b.ytdPaidCents - a.ytdPaidCents);
}

// ── quarterly estimates ──────────────────────────────────────────────────────

export interface EstimateForQuarter extends QuarterlyEstimate {
  quarter: number; dueDate: string | null;
}

/**
 * Estimates for all four quarters of a tax year, YTD-catch-up. Each quarter's
 * YTD net = revenue−expenses through the END of that quarter; prior suggested
 * payments accumulate so Q-n only asks for the incremental set-aside.
 */
export async function computeEstimates(db: Client, year: number): Promise<{
  reviewed: boolean; entityType: EntityType; quarters: EstimateForQuarter[];
} | null> {
  const constants = await getTaxConstants(db, year);
  if (!constants) return null;
  const profile = await getTaxProfile(db);
  const { from } = yearRange(year);

  const quarters: EstimateForQuarter[] = [];
  let priorSuggested = 0;
  for (let q = 1; q <= 4; q++) {
    const { endMonth } = quarterMonthRange(q);
    const qEnd = `${year}-${String(endMonth).padStart(2, '0')}-${endMonth === 2 ? '28' : ['4', '6', '9', '11'].includes(String(endMonth)) ? '30' : '31'}`;
    const [revenue, expenses, contractLabor] = await Promise.all([
      taxRevenueForRange(db, from, qEnd),
      listExpenses(db, from, qEnd),
      contractorPaidForRange(db, from, qEnd),
    ]);
    const manualExp = expenses.filter((e) => e.category !== 'contract_labor').reduce((s, e) => s + e.amountCents, 0);
    const est = computeQuarterlyEstimate({
      ytdRevenueCents: revenue.grossCents + revenue.keptDepositsCents,
      ytdExpensesCents: manualExp + contractLabor,
      entityType: profile.entityType,
      incomeTaxRatePct: profile.estimatedIncomeTaxRatePct,
      constants, priorSuggestedCents: priorSuggested,
    });
    priorSuggested += est.suggestedPaymentCents;
    quarters.push({ ...est, quarter: q, dueDate: constants.dueDates[String(q)] ?? null });
  }
  return { reviewed: constants.reviewed, entityType: profile.entityType, quarters };
}
