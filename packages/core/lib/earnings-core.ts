// lib/earnings-core.ts — the pure payroll math, extracted verbatim from
// Accounting.tsx's computeEarnings so it can be (a) revenue-share-driven from the
// DB, (b) reused by the what-if simulator, and (c) proven byte-identical by
// scripts/payroll-golden.ts.
//
// Per-row resolution order for each split: SNAPSHOT (frozen % stamped on the
// transaction) ?? per-person OVERRIDE ?? studio CONFIG ?? constant. Snapshots +
// constant fallback are why historical payroll is frozen: with no snapshots, no
// overrides, and DB defaults == constants, the output is identical to today.

import {
  ENGINEER_SESSION_SPLIT, ENGINEER_BAND_SESSION_SPLIT, PRODUCER_COMMISSION, MEDIA_SELLER_COMMISSION,
  MEDIA_WORKER_TOTAL, MEDIA_MANAGER_PCT, ENGINEERS,
} from '@/lib/constants';

/** Studio-level splits as fractions (0..1) to match every existing call site. */
export interface RevenueConfig {
  engineerSessionSplit: number;     // 0.60 (solo sessions)
  engineerBandSessionSplit: number; // 0.70 (band sessions). NOTE: computeEarningsCore does NOT read
                                    // this — bands pay via the engineer_split_pct snapshot stamped at
                                    // completion (so historical rows stay frozen). It's read by the
                                    // completion route + what-if when stamping a NEW band session.
  producerCommission: number;       // 0.60
  mediaSellerPct: number;           // 0.15
  mediaWorkerTotal: number;         // 0.50
  mediaManagerPct: number;          // 0.65 (media manager cut of COLLECTED media-booking revenue; business keeps the rest)
}

/** Seed source AND safe fallback — byte-identical to the current constants. */
export function revenueConfigFromConstants(): RevenueConfig {
  return {
    engineerSessionSplit: ENGINEER_SESSION_SPLIT,
    engineerBandSessionSplit: ENGINEER_BAND_SESSION_SPLIT,
    producerCommission: PRODUCER_COMMISSION,
    mediaSellerPct: MEDIA_SELLER_COMMISSION,
    mediaWorkerTotal: MEDIA_WORKER_TOTAL,
    mediaManagerPct: MEDIA_MANAGER_PCT,
  };
}

/** DB stores percent 0..100; the math wants a fraction 0..1. NULL/undefined → null. */
export const pctToFrac = (p: number | null | undefined): number | null =>
  p == null ? null : Number(p) / 100;

// ── name normalization (moved verbatim from Accounting.tsx) ──────────────────
// Buckets every payroll row to a canonical engineer/producer name. Historical
// names MUST stay aliased here forever (the Zion-rename lesson) so old rows net
// against current earnings instead of stranding under a dead name.
const NAME_MAP: Record<string, string> = {};
ENGINEERS.forEach((eng) => {
  NAME_MAP[eng.name.toLowerCase()] = eng.name;
  if (eng.displayName && eng.displayName !== eng.name) NAME_MAP[eng.displayName.toLowerCase()] = eng.name;
  const emailPrefix = eng.email.split('@')[0].toLowerCase();
  if (emailPrefix) NAME_MAP[emailPrefix] = eng.name;
});
NAME_MAP['zion omari'] = 'Zion';   // email-derived / legacy display
NAME_MAP['zion tinsley'] = 'Zion'; // prior roster name (renamed 2026-06-02)

export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return NAME_MAP[trimmed.toLowerCase()] || trimmed;
}

export interface PersonEarnings {
  sessionCount: number; sessionRevenue: number; sessionPay: number; sessionHours: number;
  mediaCommission: number; mediaSoldCount: number; mediaWorkerPay: number; mediaFilmedCount: number; mediaEditedCount: number;
  beatSales: number; beatProducerPay: number; beatCount: number;
  packageCommission: number; packageSoldCount: number;
  mediaManagerPay: number; mediaManagedCount: number;
  rewardsCost: number;
  bonusPay: number; bonusCount: number;
  totalPay: number;
}

// Structural row shapes — only the fields the math reads (so the live typed
// data AND the raw rows the golden script fetches both satisfy them). The *_pct
// fields are the frozen snapshots (absent today → fall back to override/config).
export interface EarningsInput {
  bookings: Array<{ status: string; engineer_name: string | null; service_value_cents?: number | null; total_amount: number; duration: number; reward_grant_id?: string | null; engineer_split_pct?: number | null }>;
  media: Array<{ sold_by: string | null; filmed_by: string | null; edited_by: string | null; amount: number; seller_pct?: number | null; worker_pct?: number | null }>;
  beats: Array<{ amount_paid: number; beats?: { producer: string | null } | null; producer_pct?: number | null }>;
  mediaSessions?: Array<{ engineer_id: string; engineer_payout_cents?: number | null }>;
  engineerNames?: Record<string, string>;
  packageCommissions?: Array<{ salesperson_name: string | null; sales_commission_cents?: number | null }>;
  bonuses?: Array<{ status: string; person_name: string | null; value_cents?: number | null }>;
  // Media-booking (contract) jobs: the assigned manager earns mediaManagerPct of
  // the COLLECTED amount. One entry per booking with a manager + collected money.
  mediaManagerJobs?: Array<{ manager_name: string | null; collected_cents: number; manager_pct?: number | null }>;
}

export interface Overrides {
  engineerByName?: Record<string, number | null>;     // normalizedName → pct (0..100), NULL = inherit
  engineerBandByName?: Record<string, number | null>; // per-engineer BAND split override (read by the completion route)
  producerByName?: Record<string, number | null>;
}

export interface EarningsOpts {
  overrides?: Overrides;
  /** what-if: ignore per-row frozen snapshots so the hypothetical cfg applies to all rows. */
  ignoreSnapshot?: boolean;
}

export function computeEarningsCore(
  input: EarningsInput,
  cfg: RevenueConfig = revenueConfigFromConstants(),
  opts: EarningsOpts = {},
): Record<string, PersonEarnings> {
  const { bookings, media, beats, mediaSessions = [], engineerNames = {}, packageCommissions = [], bonuses = [], mediaManagerJobs = [] } = input;
  const ov = opts.overrides ?? {};
  const snap = (v: number | null | undefined) => (opts.ignoreSnapshot ? null : pctToFrac(v));

  const people: Record<string, PersonEarnings> = {};
  const init = (): PersonEarnings => ({ sessionCount: 0, sessionRevenue: 0, sessionPay: 0, sessionHours: 0, mediaCommission: 0, mediaSoldCount: 0, mediaWorkerPay: 0, mediaFilmedCount: 0, mediaEditedCount: 0, beatSales: 0, beatProducerPay: 0, beatCount: 0, packageCommission: 0, packageSoldCount: 0, mediaManagerPay: 0, mediaManagedCount: 0, rewardsCost: 0, bonusPay: 0, bonusCount: 0, totalPay: 0 });

  bookings.forEach((b) => {
    if (b.status !== 'completed') return;
    const eng = normalizeName(b.engineer_name);
    if (!eng || eng === 'Unassigned') return;
    if (!people[eng]) people[eng] = init();
    // Pay on the VALUE of the work, not what the customer was charged (preserves
    // pay on comped/credit/discounted sessions). UNCHANGED base.
    const value = b.service_value_cents ?? b.total_amount;
    const frac = snap(b.engineer_split_pct) ?? pctToFrac(ov.engineerByName?.[eng]) ?? cfg.engineerSessionSplit;
    people[eng].sessionCount++;
    people[eng].sessionRevenue += b.total_amount;
    people[eng].sessionPay += Math.round(value * frac);
    people[eng].sessionHours += b.duration;
    if (b.reward_grant_id) people[eng].rewardsCost += Math.max(0, value - b.total_amount);
  });

  media.forEach((m) => {
    const seller = normalizeName(m.sold_by);
    if (seller) {
      if (!people[seller]) people[seller] = init();
      const sFrac = snap(m.seller_pct) ?? cfg.mediaSellerPct;
      people[seller].mediaSoldCount++;
      people[seller].mediaCommission += Math.round(m.amount * sFrac);
    }
    const filmer = normalizeName(m.filmed_by);
    const editor = normalizeName(m.edited_by);
    const wFrac = snap(m.worker_pct) ?? cfg.mediaWorkerTotal;
    if (filmer && editor && filmer === editor) {
      if (!people[filmer]) people[filmer] = init();
      people[filmer].mediaFilmedCount++;
      people[filmer].mediaEditedCount++;
      people[filmer].mediaWorkerPay += Math.round(m.amount * wFrac);
    } else {
      if (filmer) {
        if (!people[filmer]) people[filmer] = init();
        people[filmer].mediaFilmedCount++;
        people[filmer].mediaWorkerPay += Math.round(m.amount * wFrac / 2);
      }
      if (editor) {
        if (!people[editor]) people[editor] = init();
        people[editor].mediaEditedCount++;
        people[editor].mediaWorkerPay += Math.round(m.amount * wFrac / 2);
      }
    }
  });

  beats.forEach((p) => {
    const prod = normalizeName(p.beats?.producer ?? null);
    if (!prod) return;
    if (!people[prod]) people[prod] = init();
    const frac = snap(p.producer_pct) ?? pctToFrac(ov.producerByName?.[prod]) ?? cfg.producerCommission;
    people[prod].beatCount++;
    people[prod].beatSales += p.amount_paid;
    people[prod].beatProducerPay += Math.round(p.amount_paid * frac);
  });

  // Media sessions: admin-typed payout cents (no %), merged into worker pay.
  mediaSessions.forEach((s) => {
    const eng = normalizeName(engineerNames[s.engineer_id]);
    if (!eng) return;
    const cents = s.engineer_payout_cents ?? 0;
    if (cents <= 0) return;
    if (!people[eng]) people[eng] = init();
    people[eng].mediaWorkerPay += cents;
    people[eng].mediaFilmedCount++;
  });

  // Media MANAGER cut of COLLECTED media-booking (contract) revenue. The assigned
  // manager earns mediaManagerPct (65%) of what's been collected so far; the
  // business keeps the rest. Snapshot pct ?? config. Distinct from the per-shoot
  // worker payout above — this is the manager's share of the contract.
  mediaManagerJobs.forEach((j) => {
    const mgr = normalizeName(j.manager_name);
    if (!mgr) return;
    const collected = j.collected_cents || 0;
    if (collected <= 0) return;
    if (!people[mgr]) people[mgr] = init();
    const frac = snap(j.manager_pct) ?? cfg.mediaManagerPct;
    people[mgr].mediaManagerPay += Math.round(collected * frac);
    people[mgr].mediaManagedCount++;
  });

  // Package salesperson commissions — snapshotted cents (already frozen).
  packageCommissions.forEach((pc) => {
    const sp = normalizeName(pc.salesperson_name);
    if (!sp) return;
    const cents = pc.sales_commission_cents ?? 0;
    if (cents <= 0) return;
    if (!people[sp]) people[sp] = init();
    people[sp].packageCommission += cents;
    people[sp].packageSoldCount++;
  });

  // Staff cash bonuses (approved/issued = owed).
  bonuses.forEach((bn) => {
    if (bn.status !== 'approved' && bn.status !== 'issued') return;
    const name = normalizeName(bn.person_name);
    if (!name || name === 'Unassigned') return;
    if (!people[name]) people[name] = init();
    people[name].bonusPay += bn.value_cents || 0;
    people[name].bonusCount++;
  });

  Object.values(people).forEach((p) => {
    p.totalPay = p.sessionPay + p.mediaCommission + p.mediaWorkerPay + p.beatProducerPay + p.packageCommission + p.mediaManagerPay + p.bonusPay;
  });
  return people;
}
