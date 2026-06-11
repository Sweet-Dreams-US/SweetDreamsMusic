// lib/tax.ts — pure tax math + reference data for the Tax Center (Plan 5).
// No DB, no Next. Every dollar is integer CENTS; per-figure Math.round, summed.
//
// ⚠ PREPARATION + ORGANIZATION, NOT TAX ADVICE. ⚠ The math here and the
// tax_constants seed are HELD until a real CPA reviews them (Plan 5 pre-ship).
// Tested by scripts/tax-center-test.ts against hand-computed fixtures.

export const TAX_DISCLAIMER =
  'Preparation and organization, not tax advice. Review with your accountant.';

// ── entity types ─────────────────────────────────────────────────────────────

export type EntityType = 'sole_prop' | 'smllc' | 's_corp' | 'partnership';

export const ENTITY_TYPES: { value: EntityType; label: string; note: string }[] = [
  { value: 'sole_prop', label: 'Sole Proprietor', note: 'Schedule C + Schedule SE. Self-employment tax applies to your net profit.' },
  { value: 'smllc', label: 'Single-Member LLC', note: 'Taxed like a sole proprietor by default (Schedule C + SE) unless you elected otherwise.' },
  { value: 's_corp', label: 'S Corporation', note: 'You pay yourself reasonable W-2 wages; remaining profit passes through without SE tax. Estimates here cover the pass-through only — payroll is separate.' },
  { value: 'partnership', label: 'Partnership', note: 'Profit passes through to partners on K-1s; each partner handles their own SE tax. Estimates here are studio-level only.' },
];

/** Entities whose owner owes self-employment tax on net profit. */
export const SE_TAX_ENTITIES: EntityType[] = ['sole_prop', 'smllc'];
export const entityOwesSeTax = (e: EntityType) => SE_TAX_ENTITIES.includes(e);

// ── Schedule C expense categories (IRS line mapping) ─────────────────────────
// The IRS-line mapping is the CPA-reviewable part. Custom categories are NOT
// admin-editable in v1 (documented cut) — anything off-list maps to 'other'.

export interface ExpenseCategory { key: string; label: string; scheduleCLine: string; hint?: string }

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { key: 'advertising',           label: 'Advertising & Marketing', scheduleCLine: 'Line 8' },
  { key: 'contract_labor',        label: 'Contract Labor (1099)',   scheduleCLine: 'Line 11' },
  { key: 'supplies',              label: 'Supplies',                scheduleCLine: 'Line 22' },
  { key: 'rent',                  label: 'Rent / Lease',            scheduleCLine: 'Line 20b' },
  { key: 'utilities',             label: 'Utilities',               scheduleCLine: 'Line 25' },
  { key: 'software_subscriptions',label: 'Software & Subscriptions',scheduleCLine: 'Line 27a' },
  { key: 'insurance',             label: 'Insurance',               scheduleCLine: 'Line 15' },
  { key: 'repairs_maintenance',   label: 'Repairs & Maintenance',   scheduleCLine: 'Line 21' },
  { key: 'legal_professional',    label: 'Legal & Professional',    scheduleCLine: 'Line 17' },
  { key: 'merchant_fees',         label: 'Merchant / Processing Fees', scheduleCLine: 'Line 10' },
  { key: 'travel',                label: 'Travel',                  scheduleCLine: 'Line 24a' },
  // The three-way meals/entertainment split is deliberate UX (Plan 5 v2): the
  // picker teaches the rule at the moment of entry. Deductible % per YEAR comes
  // from tax_constants.deductible_pcts — see deductiblePctFor().
  { key: 'meals_clients',         label: 'Meals — Clients (50%)',   scheduleCLine: 'Line 24b',
    hint: 'Taking a client or collaborator to a meal.' },
  { key: 'meals_staff',           label: 'Meals — Staff/Studio (0% from 2026)', scheduleCLine: 'Line 24b',
    hint: 'Food/snacks provided to your team at the studio. 50% for 2025, 0% from 2026.' },
  { key: 'entertainment',         label: 'Entertainment (0%)',      scheduleCLine: '—',
    hint: 'Tickets, events, golf — even with clients. Not deductible; logged for complete books. Food bought separately at the venue can be Meals — Clients.' },
  { key: 'equipment',             label: 'Equipment (full first-year write-off)', scheduleCLine: 'Line 13 / Form 4562',
    hint: '100% bonus depreciation is permanent — cameras, drones, interfaces, computers are year-one deductions.' },
  { key: 'other',                 label: 'Other',                   scheduleCLine: 'Line 27a' },
];
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key);
export const expenseCategory = (key: string): ExpenseCategory =>
  EXPENSE_CATEGORIES.find((c) => c.key === key)
  ?? (key === 'meals' ? EXPENSE_CATEGORIES.find((c) => c.key === 'meals_clients')! : EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]);
/** Normalize any input to a known category key. Legacy 'meals' reads as
 *  meals_clients; anything off-list maps to 'other'. */
export const normalizeCategory = (key: string | null | undefined): string => {
  const k = String(key);
  if (k === 'meals') return 'meals_clients';
  return EXPENSE_CATEGORY_KEYS.includes(k) ? k : 'other';
};

/**
 * Deductible % for a category in a given tax year. Year-specific overrides
 * (meals_staff 50%→0% in 2026, etc.) live in tax_constants.deductible_pcts —
 * the law is data, so a rule change is a row edit, not a deploy. Built-in
 * conservative defaults when constants are missing.
 */
export function deductiblePctFor(categoryKey: string, constants: TaxConstants | null): number {
  const key = categoryKey === 'meals' ? 'meals_clients' : categoryKey;
  const fromConstants = constants?.deductiblePcts?.[categoryKey] ?? constants?.deductiblePcts?.[key];
  if (fromConstants != null) return Number(fromConstants);
  if (key === 'entertainment') return 0;
  if (key === 'meals_clients' || key === 'meals_staff') return 50;
  return 100;
}

/** Section 179 equipment auto-flag suggestion threshold ($2,500). */
export const EQUIPMENT_SUGGEST_CENTS = 250000;

// ── tax constants shape (mirrors the tax_constants table row) ────────────────

export interface TaxConstants {
  taxYear: number;
  seNetFactor: number;        // 0.9235
  seTaxRate: number;          // 0.1530 (informational; we compute SS+Medicare explicitly)
  ssWageBaseCents: number;    // annual Social Security wage cap
  ssRate: number;             // 0.1240
  medicareRate: number;       // 0.0290
  nineteen99ThresholdCents: number; // BY PAYMENT YEAR: $600 (2025) → $2,000 (2026, OBBBA) → indexed
  dueDates: Record<string, string>; // { "1": "2026-04-15", ... }
  reviewed: boolean;
  // ── OBBBA (Plan 5 v2) ──
  qbiPct: number | null;                 // 20 — permanent QBI deduction
  qbiMinDeductionCents: number | null;   // $400 minimum (2026+), null before
  qbiMinQbiFloorCents: number | null;    // requires $1,000+ active QBI
  deductiblePcts: Record<string, number>;// category → % for THIS year
  sec179LimitCents: number | null;       // display/lesson values
  sec179PhaseoutCents: number | null;
}

// ── QBI (Section 199A — 20% permanent under OBBBA) ──────────────────────────

/**
 * QBI deduction on net profit. 20% of QBI, with the OBBBA $400 minimum when
 * active QBI ≥ $1,000 (2026+; the floor/minimum constants are null for 2025).
 * Clamped to net. Phase-outs start ~$400K joint — far above typical studio
 * income; the assumptions sheet states this cap. Zero when qbiPct is null or
 * the owner turned apply_qbi off.
 */
export function qbiDeductionCents(netCents: number, c: TaxConstants): number {
  if (netCents <= 0 || c.qbiPct == null) return 0;
  let deduction = Math.round(netCents * (Number(c.qbiPct) / 100));
  if (c.qbiMinDeductionCents != null && c.qbiMinQbiFloorCents != null
      && netCents >= c.qbiMinQbiFloorCents) {
    deduction = Math.max(deduction, c.qbiMinDeductionCents);
  }
  return Math.min(deduction, netCents);
}

// ── self-employment tax (Schedule SE) ────────────────────────────────────────

/**
 * SE tax on net self-employment profit, with the Social Security wage-base cap:
 *   base   = round(net × 92.35%)
 *   SS     = round(min(base, wageBase) × 12.4%)
 *   Medi   = round(base × 2.9%)
 *   SE tax = SS + Medicare
 * (For typical studio net below the wage base this equals base × 15.3% — the
 * plan's simpler statement — but the cap keeps it correct at high net.)
 * Zero for non-SE entities (S corp / partnership handle SE elsewhere) and for
 * net ≤ 0.
 */
export function seTaxCents(netCents: number, c: TaxConstants, entity: EntityType): number {
  if (!entityOwesSeTax(entity) || netCents <= 0) return 0;
  const base = Math.round(netCents * c.seNetFactor);
  const ss = Math.round(Math.min(base, c.ssWageBaseCents) * c.ssRate);
  const medicare = Math.round(base * c.medicareRate);
  return ss + medicare;
}

/** Flat income-tax estimate at the owner-set rate (e.g. 22%). Net ≤ 0 → 0. */
export function incomeTaxCents(netCents: number, incomeTaxRatePct: number): number {
  if (netCents <= 0) return 0;
  return Math.round(netCents * (incomeTaxRatePct / 100));
}

// ── quarterly estimate ───────────────────────────────────────────────────────

export interface QuarterlyEstimateInput {
  ytdRevenueCents: number;
  ytdExpensesCents: number;
  entityType: EntityType;
  incomeTaxRatePct: number;
  constants: TaxConstants;
  /** Sum of the SUGGESTED payments from quarters before this one (catch-up basis). */
  priorSuggestedCents: number;
  /** Owner toggle (business_tax_profiles.apply_qbi, default true). */
  applyQbi?: boolean;
}

export interface QuarterlyEstimate {
  ytdNetCents: number;
  seTaxCents: number;
  qbiDeductionCents: number;       // 0 when QBI off / not applicable
  incomeTaxCents: number;
  totalYtdLiabilityCents: number;
  suggestedPaymentCents: number;   // this quarter, after subtracting prior suggested
}

/**
 * YTD-catch-up method: estimate total tax owed on YTD net, then this quarter's
 * set-aside = that total minus what earlier quarters already suggested (never
 * negative). With apply_qbi (default): income tax base = net − QBI deduction
 * (20%, $400 minimum at $1,000+ QBI from 2026) — materially better accuracy
 * for nearly every studio. SE tax is computed on FULL net (QBI doesn't reduce
 * SE). S corp / partnership skip the SE block (owner payroll / K-1 carries it).
 */
export function computeQuarterlyEstimate(input: QuarterlyEstimateInput): QuarterlyEstimate {
  const ytdNet = input.ytdRevenueCents - input.ytdExpensesCents;
  const se = seTaxCents(ytdNet, input.constants, input.entityType);
  const qbi = (input.applyQbi ?? true) ? qbiDeductionCents(ytdNet, input.constants) : 0;
  const inc = incomeTaxCents(Math.max(0, ytdNet - qbi), input.incomeTaxRatePct);
  const total = se + inc;
  const suggested = Math.max(0, total - input.priorSuggestedCents);
  return {
    ytdNetCents: ytdNet,
    seTaxCents: se,
    qbiDeductionCents: qbi,
    incomeTaxCents: inc,
    totalYtdLiabilityCents: total,
    suggestedPaymentCents: suggested,
  };
}

// ── quarter / due-date helpers ───────────────────────────────────────────────

/** IRS estimated-tax quarter (1–4) for a calendar month (1–12). Q1=Jan–Mar … Q4=Sep–Dec. */
export function quarterOfMonth(month1to12: number): number {
  return Math.min(4, Math.floor((month1to12 - 1) / 3) + 1);
}

/** Inclusive calendar-month range [start,end] (1-based) for an estimate quarter. */
export function quarterMonthRange(quarter: number): { startMonth: number; endMonth: number } {
  const startMonth = (quarter - 1) * 3 + 1;
  return { startMonth, endMonth: startMonth + 2 };
}

/** Days until a due-date ISO string from a reference ISO date (negative = past). */
export function daysUntil(dueDateIso: string, fromIso: string): number {
  return Math.round((Date.parse(`${dueDateIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

// ── 1099 compliance ──────────────────────────────────────────────────────────

/** A contractor needs a 1099-NEC once YTD payments reach the threshold ($600). */
export function needs1099(ytdPaidCents: number, c: TaxConstants): boolean {
  return ytdPaidCents >= c.nineteen99ThresholdCents;
}

export interface ContractorComplianceInput {
  ytdPaidCents: number;
  hasW9: boolean;
  constants: TaxConstants;
}
export type ComplianceFlag = 'ok' | 'needs_1099' | 'needs_1099_missing_w9' | 'below_threshold'
  | 'owner'          // S-corp/partnership owner pay — never 1099 contract labor
  | 'no_constants';  // the year's tax tables aren't configured — status UNKNOWN, not "under $600"

/**
 * The "what to file for this person" answer. Missing W-9 + over threshold is the
 * loud persistent warning (not a January surprise).
 */
export function contractorCompliance(input: ContractorComplianceInput): {
  needs1099: boolean; flag: ComplianceFlag;
} {
  const over = needs1099(input.ytdPaidCents, input.constants);
  if (!over) return { needs1099: false, flag: 'below_threshold' };
  return { needs1099: true, flag: input.hasW9 ? 'needs_1099' : 'needs_1099_missing_w9' };
}
