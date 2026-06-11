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
  contractorCompliance, quarterMonthRange, deductiblePctFor,
  type EntityType, type TaxConstants, type QuarterlyEstimate,
} from '@/lib/tax';
import { computeEarningsCore, normalizeName, revenueConfigFromConstants } from '@/lib/earnings-core';

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
  applyQbi: boolean;
  notes: string | null;
}

const DEFAULT_PROFILE: TaxProfile = {
  entityType: 'sole_prop', einLast4: null, state: null,
  fiscalYearStartMonth: 1, estimatedIncomeTaxRatePct: 22, applyQbi: true, notes: null,
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
    applyQbi: r.apply_qbi ?? true,
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
    // OBBBA (v2): law-as-data — QBI + per-year deductibility + Sec 179 display.
    qbiPct: r.qbi_pct != null ? Number(r.qbi_pct) : null,
    qbiMinDeductionCents: r.qbi_min_deduction_cents != null ? Number(r.qbi_min_deduction_cents) : null,
    qbiMinQbiFloorCents: r.qbi_min_qbi_floor_cents != null ? Number(r.qbi_min_qbi_floor_cents) : null,
    deductiblePcts: (r.deductible_pcts as Record<string, number>) ?? {},
    sec179LimitCents: r.sec179_limit_cents != null ? Number(r.sec179_limit_cents) : null,
    sec179PhaseoutCents: r.sec179_phaseout_cents != null ? Number(r.sec179_phaseout_cents) : null,
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

/**
 * EXACT staff earnings attributed to a period's WORK — the same earnings
 * engine the Payroll tab pays from (computeEarningsCore), run over the
 * period's rows: completed sessions by session date (per-row snapshot splits,
 * service-value basis), media commissions, completed media-shoot payouts,
 * beat producer splits, package commissions. This is the P&L contract-labor
 * line so labor sits on the SAME basis as revenue (work attribution) —
 * mixing cash-out payouts into a work-dated P&L made monthly net profit
 * incoherent (Overview $2,555 earned vs $4,028 paid out, May 2026).
 * Owner-marked contractors are excluded (owner pay ≠ contract labor).
 * NOTE: reward staff bonuses (dormant system) not included — revisit at
 * rewards launch.
 */
export async function staffEarningsForRange(db: Client, fromIso: string, toIso: string): Promise<number> {
  const toTs = `${toIso}T23:59:59`;
  const [bk, ms, bp, msess, pc, owners] = await Promise.all([
    db.from('bookings')
      .select('status,engineer_name,service_value_cents,total_amount,duration,reward_grant_id,engineer_split_pct')
      .not('status', 'eq', 'cancelled').gte('start_time', fromIso).lte('start_time', toTs),
    db.from('media_sales').select('sold_by,filmed_by,edited_by,amount,seller_pct,worker_pct')
      .gte('created_at', fromIso).lte('created_at', toTs),
    db.from('beat_purchases').select('amount_paid,producer_pct,beats(producer)')
      .gte('created_at', fromIso).lte('created_at', toTs),
    db.from('media_session_bookings').select('engineer_id,engineer_payout_cents,status,starts_at')
      .eq('status', 'completed').not('engineer_payout_cents', 'is', null)
      .gte('starts_at', fromIso).lte('starts_at', toTs),
    db.from('package_entitlements').select('salesperson_name,sales_commission_cents,created_at')
      .not('salesperson_name', 'is', null).gt('sales_commission_cents', 0)
      .gte('created_at', fromIso).lte('created_at', toTs),
    db.from('contractors').select('display_name,legal_name').eq('is_owner', true),
  ]);

  // Names for media-shoot payouts (engineer_id → display name).
  const sessRows = (msess.data ?? []) as any[];
  const engineerNames: Record<string, string> = {};
  const ids = Array.from(new Set(sessRows.map((s) => s.engineer_id).filter(Boolean)));
  if (ids.length) {
    const { data: profs } = await db.from('profiles').select('user_id,display_name').in('user_id', ids);
    for (const p of (profs ?? []) as any[]) engineerNames[p.user_id] = p.display_name || 'Unknown';
  }

  const earnings = computeEarningsCore({
    bookings: (bk.data ?? []) as never,
    media: (ms.data ?? []) as never,
    beats: (bp.data ?? []) as never,
    mediaSessions: sessRows as never,
    engineerNames,
    packageCommissions: (pc.data ?? []) as never,
  }, revenueConfigFromConstants());

  const ownerNames = new Set(((owners.data ?? []) as any[])
    .flatMap((o) => [o.display_name, o.legal_name]).filter(Boolean)
    .map((n) => normalizeName(String(n)) ?? ''));
  return Object.entries(earnings).reduce((s, [name, p]) =>
    ownerNames.has(normalizeName(name) ?? '') ? s : s + p.totalPay, 0);
}

/**
 * Total ACTUAL contractor pay in a window (payroll_payouts, all methods incl.
 * cash) — the 1099/contractor-dashboard basis (a 1099 reports what you PAID
 * someone in the calendar year, per IRS rules) — EXCLUDING is_owner payees.
 */
export async function contractorPaidForRange(db: Client, fromIso: string, toIso: string): Promise<number> {
  const [{ data }, { data: owners }] = await Promise.all([
    db.from('payroll_payouts').select('amount,contractor_id,person_name')
      .gte('created_at', fromIso).lte('created_at', `${toIso}T23:59:59`),
    db.from('contractors').select('id,display_name,legal_name').eq('is_owner', true),
  ]);
  const ownerIds = new Set(((owners ?? []) as any[]).map((o) => o.id));
  const ownerNames = new Set(((owners ?? []) as any[])
    .flatMap((o) => [o.display_name, o.legal_name]).filter(Boolean)
    .map((n) => normalizeName(String(n)) ?? ''));
  return ((data ?? []) as any[]).reduce((s, r) => {
    if (r.contractor_id && ownerIds.has(r.contractor_id)) return s;
    if (!r.contractor_id && ownerNames.has(normalizeName(String(r.person_name || '')) ?? '')) return s;
    return s + (Number(r.amount) || 0);
  }, 0);
}

export interface PnL {
  year: number;                       // year of the range start (display)
  from: string; to: string;           // the actual period
  revenue: RevenueBreakdown;
  totalRevenueCents: number;          // gross + kept deposits (the P&L top line)
  expensesByCategory: {
    key: string; label: string; scheduleCLine: string; amountCents: number;
    deductiblePct: number;            // per YEAR from tax_constants (meals_staff 0% from 2026, etc.)
    deductibleCents: number;          // amount × pct — the column the CPA packet shows
  }[];
  contractLaborCents: number;         // EXACT staff earnings for the period's work (matches the revenue basis + the Overview)
  paidOutCents: number;               // cash payouts RECORDED in the period (reference; the 1099 basis)
  manualExpensesCents: number;        // business_expenses excluding any 'contract_labor' rows
  totalExpensesCents: number;         // CASH expenses (all of them — the books)
  deductibleExpensesCents: number;    // tax-deductible portion only (the taxable-net basis)
  nondeductibleCents: number;         // entertainment / staff meals etc. — logged, not deducted
  netProfitCents: number;             // cash net (revenue − all expenses)
  taxableNetCents: number;            // revenue − deductible expenses (estimates use this)
  // Equipment headline (OBBBA: 100% bonus depreciation permanent) —
  // "YTD equipment invested next to its full deduction value".
  equipmentInvestedCents: number;
  equipmentDeductionCents: number;
}

/**
 * P&L for an arbitrary period (the Accounting Profit view passes its month/
 * quarter/custom range; the Tax Center passes whole years). Contract labor =
 * EXACT staff earnings for the period's work (same engine + basis as revenue
 * and the Overview card), so monthly net profit is coherent. Cash payouts
 * recorded in the period ride along as `paidOutCents` for reference. The
 * contract_labor expense category is IGNORED on manual rows (auto-fed; never
 * double-entered).
 */
export async function computePnLRange(db: Client, from: string, to: string): Promise<PnL> {
  const year = Number(from.slice(0, 4));
  const [revenue, expenses, contractLaborCents, paidOutCents, constants] = await Promise.all([
    taxRevenueForRange(db, from, to),
    listExpenses(db, from, to),
    staffEarningsForRange(db, from, to),
    contractorPaidForRange(db, from, to),
    getTaxConstants(db, year),
  ]);

  const byCat = new Map<string, number>();
  let manualExpensesCents = 0;
  let equipmentInvestedCents = 0;
  for (const e of expenses) {
    if (e.category === 'contract_labor') continue; // auto-fed below; never double-count
    const key = normalizeCategory(e.category);     // legacy 'meals' → meals_clients
    byCat.set(key, (byCat.get(key) || 0) + e.amountCents);
    manualExpensesCents += e.amountCents;
    if (e.isEquipment || key === 'equipment') equipmentInvestedCents += e.amountCents;
  }
  byCat.set('contract_labor', contractLaborCents);

  const expensesByCategory = EXPENSE_CATEGORIES
    .map((c) => {
      const amountCents = byCat.get(c.key) || 0;
      const deductiblePct = deductiblePctFor(c.key, constants);
      return {
        key: c.key, label: c.label, scheduleCLine: c.scheduleCLine, amountCents,
        deductiblePct, deductibleCents: Math.round(amountCents * (deductiblePct / 100)),
      };
    })
    .filter((c) => c.amountCents > 0);

  const totalRevenueCents = revenue.grossCents + revenue.keptDepositsCents;
  const totalExpensesCents = manualExpensesCents + contractLaborCents;
  const deductibleExpensesCents = expensesByCategory.reduce((s, c) => s + c.deductibleCents, 0);
  return {
    year, from, to,
    revenue, totalRevenueCents, expensesByCategory,
    contractLaborCents, paidOutCents, manualExpensesCents, totalExpensesCents,
    deductibleExpensesCents,
    nondeductibleCents: totalExpensesCents - deductibleExpensesCents,
    netProfitCents: totalRevenueCents - totalExpensesCents,
    taxableNetCents: totalRevenueCents - deductibleExpensesCents,
    equipmentInvestedCents,
    // 100% bonus depreciation is permanent (OBBBA) → the full purchase is the
    // year-one deduction candidate. The CPA elects bonus vs Section 179.
    equipmentDeductionCents: equipmentInvestedCents,
  };
}

/** Whole-year P&L (the Tax Center home + CPA packet basis). */
export async function computePnL(db: Client, year: number): Promise<PnL> {
  const { from, to } = yearRange(year);
  return computePnLRange(db, from, to);
}

// ── contractor compliance ────────────────────────────────────────────────────

export interface ContractorCard {
  id: string; legalName: string; displayName: string; businessName: string | null;
  hasW9: boolean; w9ReceivedAt: string | null; tinLast4: string | null;
  w9StoragePath: string | null;
  ytdPaidCents: number; needs1099: boolean; flag: string;
  methods: string[]; cashCents: number;
  isOwner: boolean;
  filed1099On: string | null;   // ISO date the 1099 was marked filed for this year
  addressLine1: string | null; addressLine2: string | null;
  city: string | null; state: string | null; zip: string | null;
  entityType: string | null;
  /** The PAYMENT-YEAR threshold ($600 for 2025, $2,000 for 2026 — OBBBA). */
  thresholdCents: number | null;
  /** Studio chose to issue a 1099 below threshold (complete paper trail). */
  voluntary1099: boolean;
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

  // Roll YTD pay up to a contractor. The two buckets are DISJOINT by
  // construction — FK-linked payouts go in byContractor, contractor_id-NULL
  // payouts in byName — and each contractor SUMS both, so an unlinked payout
  // can never silently vanish from a 1099 total (review-fleet critical: the old
  // `??` fallback dropped NULL-FK payouts whenever any FK-linked row existed).
  type Agg = { total: number; cash: number; methods: Set<string> };
  const byContractor = new Map<string, Agg>();
  const byName = new Map<string, Agg>();
  for (const p of (payouts ?? []) as any[]) {
    const amt = Number(p.amount) || 0;
    const bucket = (m: Map<string, Agg>, key: string) => {
      if (!m.has(key)) m.set(key, { total: 0, cash: 0, methods: new Set<string>() });
      const b = m.get(key)!; b.total += amt; if (p.method === 'cash') b.cash += amt; b.methods.add(p.method);
    };
    if (p.contractor_id) bucket(byContractor, p.contractor_id);
    else bucket(byName, normalizeName(String(p.person_name || '')) ?? '');
  }

  return ((contractors ?? []) as any[]).map((c) => {
    const linked = byContractor.get(c.id);
    const unlinked = byName.get(normalizeName(String(c.display_name || c.legal_name || '')) ?? '');
    const agg: Agg = {
      total: (linked?.total ?? 0) + (unlinked?.total ?? 0),
      cash: (linked?.cash ?? 0) + (unlinked?.cash ?? 0),
      methods: new Set<string>([...(linked?.methods ?? []), ...(unlinked?.methods ?? [])]),
    };
    const hasW9 = !!c.w9_storage_path || !!c.w9_received_at;
    // Owner pay is NEVER 1099 contract labor (the S-corp misclassification
    // trap); a missing constants year is UNKNOWN, never a false "under $600".
    const comp = c.is_owner
      ? { needs1099: false, flag: 'owner' as const }
      : constants
        ? contractorCompliance({ ytdPaidCents: agg.total, hasW9, constants })
        : { needs1099: false, flag: 'no_constants' as const };
    return {
      id: c.id, legalName: c.legal_name, displayName: c.display_name || c.legal_name,
      businessName: c.business_name ?? null, hasW9, w9ReceivedAt: c.w9_received_at ?? null,
      tinLast4: c.tin_last4 ?? null, w9StoragePath: c.w9_storage_path ?? null,
      ytdPaidCents: agg.total,
      needs1099: comp.needs1099, flag: comp.flag,
      methods: Array.from(agg.methods), cashCents: agg.cash,
      isOwner: !!c.is_owner,
      filed1099On: (c.filings as Record<string, string> | null)?.[String(year)] ?? null,
      addressLine1: c.address_line1 ?? null, addressLine2: c.address_line2 ?? null,
      city: c.city ?? null, state: c.state ?? null, zip: c.zip ?? null,
      entityType: c.entity_type ?? null,
      thresholdCents: constants?.nineteen99ThresholdCents ?? null,
      voluntary1099: !!c.voluntary_1099,
    };
  }).sort((a, b) => b.ytdPaidCents - a.ytdPaidCents);
}

// ── quarterly estimates ──────────────────────────────────────────────────────

export interface EstimateForQuarter extends QuarterlyEstimate {
  quarter: number; dueDate: string | null;
  /** What the owner ACTUALLY paid for this quarter (tax_payments), null if unrecorded. */
  paidCents: number | null;
  paidOn: string | null;
}

/**
 * Estimates for all four quarters of a tax year, YTD-catch-up. Each quarter's
 * YTD net = revenue−expenses through the END of that quarter. The catch-up
 * basis prefers what the owner ACTUALLY paid (tax_payments) over what was
 * suggested — paying more than suggested reduces later quarters; skipping a
 * quarter rolls it forward.
 */
export async function computeEstimates(db: Client, year: number): Promise<{
  reviewed: boolean; entityType: EntityType; quarters: EstimateForQuarter[];
} | null> {
  const constants = await getTaxConstants(db, year);
  if (!constants) return null;
  const profile = await getTaxProfile(db);
  const { from } = yearRange(year);

  // Actual payments recorded for the year, summed per quarter.
  const { data: payRows } = await db.from('tax_payments')
    .select('quarter,paid_cents,paid_on').eq('tax_year', year).is('studio_id', null);
  const paidByQuarter = new Map<number, { cents: number; lastOn: string | null }>();
  for (const p of (payRows ?? []) as any[]) {
    const cur = paidByQuarter.get(p.quarter) ?? { cents: 0, lastOn: null };
    cur.cents += Number(p.paid_cents) || 0;
    cur.lastOn = p.paid_on ?? cur.lastOn;
    paidByQuarter.set(p.quarter, cur);
  }

  const quarters: EstimateForQuarter[] = [];
  let priorBasis = 0; // Σ over earlier quarters of (actual paid ?? suggested)
  for (let q = 1; q <= 4; q++) {
    const { endMonth } = quarterMonthRange(q);
    const qEnd = `${year}-${String(endMonth).padStart(2, '0')}-${endMonth === 2 ? '28' : ['4', '6', '9', '11'].includes(String(endMonth)) ? '30' : '31'}`;
    const [revenue, expenses, contractLabor] = await Promise.all([
      taxRevenueForRange(db, from, qEnd),
      listExpenses(db, from, qEnd),
      staffEarningsForRange(db, from, qEnd), // same work-attribution basis as revenue
    ]);
    // DEDUCTIBLE basis (v2): entertainment and (from 2026) staff meals are
    // logged for complete books but must not reduce the taxable-net estimate.
    const manualExp = expenses
      .filter((e) => e.category !== 'contract_labor')
      .reduce((s, e) => s + Math.round(e.amountCents * (deductiblePctFor(normalizeCategory(e.category), constants) / 100)), 0);
    const est = computeQuarterlyEstimate({
      ytdRevenueCents: revenue.grossCents + revenue.keptDepositsCents,
      ytdExpensesCents: manualExp + contractLabor,
      entityType: profile.entityType,
      incomeTaxRatePct: profile.estimatedIncomeTaxRatePct,
      constants, priorSuggestedCents: priorBasis,
      applyQbi: profile.applyQbi,
    });
    const paid = paidByQuarter.get(q);
    priorBasis += paid != null ? paid.cents : est.suggestedPaymentCents;
    quarters.push({
      ...est, quarter: q, dueDate: constants.dueDates[String(q)] ?? null,
      paidCents: paid?.cents ?? null, paidOn: paid?.lastOn ?? null,
    });
  }
  return { reviewed: constants.reviewed, entityType: profile.entityType, quarters };
}
