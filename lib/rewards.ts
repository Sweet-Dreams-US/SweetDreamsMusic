// lib/rewards.ts — canonical reward ruleset + pure helpers (no server deps).
//
// This is the ONE source of truth for the reward ladders. The DB `reward_rules`
// table is SEEDED from REWARD_RULES (see lib/rewards-server.ts seedRewardRules),
// so admins can later tune numbers in the DB without code, but the defaults live
// here. Design: docs/superpowers/specs/2026-06-05-rewards-achievements-roadmap.md
//
// Money is ALWAYS cents. Hours are decimal hours. Discounts are whole percents.
// Counters are measured inside each rule's WINDOW (all calendar-aligned).

export type RewardTrack = 'customer' | 'band' | 'engineer' | 'producer' | 'media_manager';

export type RewardCounter =
  | 'studio_hours'        // customer: completed studio hours (sum of booking duration)
  | 'dollars_spent'       // customer: cents paid across studio + media + beats
  | 'beat_spend'          // customer: cents paid on BEAT purchases only (separate ladder)
  | 'music_video_purchase'// customer: a music-video purchase (drives bundled cutdowns)
  | 'referral'            // customer: a converted referral
  | 'profile_complete'    // customer: finished profile (one-time)
  | 'review'              // customer: left a review (screenshot-verified)
  | 'band_hours'          // band: completed studio hours on the band account
  | 'band_spend'          // band: cents paid on the band account
  | 'hours_run'           // engineer: completed hours run
  | 'review_invite'       // engineer: a review left via their invite
  | 'producer_revenue'    // producer: gross beat-sale revenue (cents)
  | 'media_revenue';      // media manager: gross job revenue delivered (cents)

export type RewardWindow =
  | 'calendar_year' | 'monthly' | 'quarterly' | 'per_purchase' | 'per_event' | 'one_time' | 'lifetime';

export type RewardType =
  | 'free_hours' | 'free_short_video' | 'free_music_video' | 'free_photo_session'
  | 'bundled_cutdowns' | 'mv_discount_pct' | 'spend_discount_pct'
  | 'referral_discount_pct' | 'account_credit_cents' | 'cash_bonus' | 'cash_per_hour'
  | 'beat_lease_discount_pct' | 'beat_exclusive_discount_pct' // beat-store discounts, license-scoped
  | 'status' | 'perk';

export type Issuance = 'auto' | 'approval';
export type StackMode = 'one_total' | 'cumulative';

export interface RewardRule {
  rule_key: string;
  track: RewardTrack;
  label: string;
  counter: RewardCounter;
  threshold: number;        // hours | cents | count, per counter
  window: RewardWindow;
  reward_type: RewardType;
  reward_value: number;     // hours | percent | cents | count | cents-per-hour
  reward_cap_cents?: number;
  issuance: Issuance;
  stack_mode: StackMode;
  expires_days?: number | null;  // redemption expiry; null/undefined = never
  effective_from?: string | null; // 'YYYY-MM-DD' — rule only counts activity on/after this (overrides global launch)
  visible?: boolean;        // default true
  sort_order: number;
  notes?: string;
}

const DOLLAR = 100; // cents per dollar
const EXPIRES = 90; // default redemption expiry for free work

// ───────────────────────── CUSTOMER ─────────────────────────
// Studio loyalty — by completed HOURS, per calendar year. Each rung grants once
// (cumulative), rewards intentionally varied. Free work needs approval.
const CUSTOMER_STUDIO_HOURS: RewardRule[] = [
  { rule_key: 'cust_sh_5',   track: 'customer', label: '5 studio hours → free short-form video',         counter: 'studio_hours', threshold: 5,   window: 'calendar_year', reward_type: 'free_short_video', reward_value: 1, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 10 },
  { rule_key: 'cust_sh_10',  track: 'customer', label: '10 studio hours → free studio hour',             counter: 'studio_hours', threshold: 10,  window: 'calendar_year', reward_type: 'free_hours',       reward_value: 1, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 20 },
  { rule_key: 'cust_sh_20',  track: 'customer', label: '20 studio hours → 25% off a music video',        counter: 'studio_hours', threshold: 20,  window: 'calendar_year', reward_type: 'mv_discount_pct',  reward_value: 25, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 30 },
  { rule_key: 'cust_sh_35',  track: 'customer', label: '35 studio hours → 2 free studio hours',          counter: 'studio_hours', threshold: 35,  window: 'calendar_year', reward_type: 'free_hours',       reward_value: 2, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 40 },
  { rule_key: 'cust_sh_50a', track: 'customer', label: '50 studio hours → free short video',             counter: 'studio_hours', threshold: 50,  window: 'calendar_year', reward_type: 'free_short_video', reward_value: 1, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 50 },
  { rule_key: 'cust_sh_50b', track: 'customer', label: '50 studio hours → free studio hour',             counter: 'studio_hours', threshold: 50,  window: 'calendar_year', reward_type: 'free_hours',       reward_value: 1, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 51 },
  { rule_key: 'cust_sh_75',  track: 'customer', label: '75 studio hours → 40% off a music video',        counter: 'studio_hours', threshold: 75,  window: 'calendar_year', reward_type: 'mv_discount_pct',  reward_value: 40, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 60 },
  { rule_key: 'cust_sh_100', track: 'customer', label: '100 studio hours → free music video (up to $1k) or 5 free hours', counter: 'studio_hours', threshold: 100, window: 'calendar_year', reward_type: 'free_music_video', reward_value: 1, reward_cap_cents: 1000 * DOLLAR, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 70, notes: 'Alt redemption: 5 free studio hours.' },
];

// Spend loyalty — by lifetime $ spent per calendar year. ONE total (your tier =
// the highest reached); standing discount for the rest of the year; auto; no expiry.
const CUSTOMER_SPEND: RewardRule[] = [
  { rule_key: 'cust_spend_1000',  track: 'customer', label: '$1,000 spent → 2% off rest of year',  counter: 'dollars_spent', threshold: 1000 * DOLLAR,  window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 2,  issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 110 },
  { rule_key: 'cust_spend_2000',  track: 'customer', label: '$2,000 spent → 5% off rest of year',  counter: 'dollars_spent', threshold: 2000 * DOLLAR,  window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 5,  issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 120 },
  { rule_key: 'cust_spend_5000',  track: 'customer', label: '$5,000 spent → 10% off rest of year', counter: 'dollars_spent', threshold: 5000 * DOLLAR,  window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 10, issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 130 },
  { rule_key: 'cust_spend_10000', track: 'customer', label: '$10,000 spent → 15% off rest of year',counter: 'dollars_spent', threshold: 10000 * DOLLAR, window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 15, issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 140 },
  { rule_key: 'cust_spend_20000', track: 'customer', label: '$20,000 spent → 20% off rest of year',counter: 'dollars_spent', threshold: 20000 * DOLLAR, window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 20, issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 150 },
];

// Beat-store loyalty — by $ spent on BEATS ONLY, per calendar year (separate from
// the combined dollars_spent ladder). Discounts are LICENSE-SCOPED: lease discounts
// (mp3/trackout) are best-of (one_total); exclusives get a single high-spend perk.
// Free studio hours cross-sell beat buyers into sessions.
const CUSTOMER_BEAT_SPEND: RewardRule[] = [
  { rule_key: 'cust_beat_75',    track: 'customer', label: '$75 in beats → 10% off beat leases',     counter: 'beat_spend', threshold: 75 * DOLLAR,   window: 'calendar_year', reward_type: 'beat_lease_discount_pct',     reward_value: 10, issuance: 'auto',     stack_mode: 'one_total',  expires_days: null,    sort_order: 160 },
  { rule_key: 'cust_beat_150',   track: 'customer', label: '$150 in beats → 20% off beat leases',    counter: 'beat_spend', threshold: 150 * DOLLAR,  window: 'calendar_year', reward_type: 'beat_lease_discount_pct',     reward_value: 20, issuance: 'auto',     stack_mode: 'one_total',  expires_days: null,    sort_order: 161 },
  { rule_key: 'cust_beat_300',   track: 'customer', label: '$300 in beats → 1 free studio hour',     counter: 'beat_spend', threshold: 300 * DOLLAR,  window: 'calendar_year', reward_type: 'free_hours',                 reward_value: 1,  issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 162 },
  { rule_key: 'cust_beat_600',   track: 'customer', label: '$600 in beats → 25% off beat leases',    counter: 'beat_spend', threshold: 600 * DOLLAR,  window: 'calendar_year', reward_type: 'beat_lease_discount_pct',     reward_value: 25, issuance: 'auto',     stack_mode: 'one_total',  expires_days: null,    sort_order: 163 },
  { rule_key: 'cust_beat_1000h', track: 'customer', label: '$1,000 in beats → 2 free studio hours',  counter: 'beat_spend', threshold: 1000 * DOLLAR, window: 'calendar_year', reward_type: 'free_hours',                 reward_value: 2,  issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 164 },
  { rule_key: 'cust_beat_1000x', track: 'customer', label: '$1,000 in beats → 15% off an exclusive', counter: 'beat_spend', threshold: 1000 * DOLLAR, window: 'calendar_year', reward_type: 'beat_exclusive_discount_pct', reward_value: 15, issuance: 'auto',     stack_mode: 'one_total',  expires_days: null,    sort_order: 165 },
];

// Music-video cutdowns — bundled with the purchase, 1 free cutdown per $250 spent
// (handled specially: count = floor(price_cents / CUTDOWN_PER_CENTS)). Auto.
export const CUTDOWN_PER_CENTS = 250 * DOLLAR;
const CUSTOMER_MEDIA: RewardRule[] = [
  { rule_key: 'cust_mv_cutdowns', track: 'customer', label: 'Music video → free cutdowns (1 per $250)', counter: 'music_video_purchase', threshold: 0, window: 'per_purchase', reward_type: 'bundled_cutdowns', reward_value: CUTDOWN_PER_CENTS, issuance: 'auto', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 200 },
];

// Referrals + onboarding.
const CUSTOMER_GROWTH: RewardRule[] = [
  { rule_key: 'cust_referral',         track: 'customer', label: 'Referred friend books a session → 25% off your next session', counter: 'referral',         threshold: 1, window: 'per_event', reward_type: 'referral_discount_pct', reward_value: 25, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 210 },
  { rule_key: 'cust_profile_complete', track: 'customer', label: 'Complete your profile → 1 free studio hour',                   counter: 'profile_complete', threshold: 1, window: 'one_time',  reward_type: 'free_hours',           reward_value: 1,  issuance: 'approval', stack_mode: 'one_total',  expires_days: EXPIRES, sort_order: 220, notes: 'One per real person; gated to first booking.' },
  { rule_key: 'cust_review',           track: 'customer', label: 'Leave a review (screenshot) → $20 account credit',             counter: 'review',           threshold: 1, window: 'per_event', reward_type: 'account_credit_cents', reward_value: 20 * DOLLAR, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 230 },
];

// ───────────────────────── BAND ─────────────────────────
const BAND_HOURS: RewardRule[] = [
  { rule_key: 'band_sh_20',  track: 'band', label: '20 band hours → free band short-form video', counter: 'band_hours', threshold: 20,  window: 'calendar_year', reward_type: 'free_short_video',   reward_value: 1, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 310 },
  { rule_key: 'band_sh_40',  track: 'band', label: '40 band hours → 2 free studio hours',         counter: 'band_hours', threshold: 40,  window: 'calendar_year', reward_type: 'free_hours',         reward_value: 2, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 320 },
  { rule_key: 'band_sh_80',  track: 'band', label: '80 band hours → free photo session (or 25% off MV)', counter: 'band_hours', threshold: 80, window: 'calendar_year', reward_type: 'free_photo_session', reward_value: 1, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 330, notes: 'Alt: 25% off a music video.' },
  { rule_key: 'band_sh_120', track: 'band', label: '120 band hours → free music video (up to $1.5k)', counter: 'band_hours', threshold: 120, window: 'calendar_year', reward_type: 'free_music_video', reward_value: 1, reward_cap_cents: 1500 * DOLLAR, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 340 },
  { rule_key: 'band_sh_160a',track: 'band', label: '160 band hours → free recording day (5 hours)', counter: 'band_hours', threshold: 160, window: 'calendar_year', reward_type: 'free_hours', reward_value: 5, issuance: 'approval', stack_mode: 'cumulative', expires_days: EXPIRES, sort_order: 350 },
  { rule_key: 'band_sh_160b',track: 'band', label: '160 band hours → "Resident Band" status',      counter: 'band_hours', threshold: 160, window: 'calendar_year', reward_type: 'status', reward_value: 0, issuance: 'approval', stack_mode: 'one_total', expires_days: null, sort_order: 351, notes: 'Resident Band status.' },
];
const BAND_SPEND: RewardRule[] = [
  { rule_key: 'band_spend_3000',  track: 'band', label: '$3,000 band spend → 5% off rest of year',  counter: 'band_spend', threshold: 3000 * DOLLAR,  window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 5,  issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 360 },
  { rule_key: 'band_spend_6000',  track: 'band', label: '$6,000 band spend → 10% off rest of year', counter: 'band_spend', threshold: 6000 * DOLLAR,  window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 10, issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 370 },
  { rule_key: 'band_spend_12000', track: 'band', label: '$12,000 band spend → 15% off rest of year',counter: 'band_spend', threshold: 12000 * DOLLAR, window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 15, issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 380 },
  { rule_key: 'band_spend_25000', track: 'band', label: '$25,000 band spend → 20% off rest of year',counter: 'band_spend', threshold: 25000 * DOLLAR, window: 'calendar_year', reward_type: 'spend_discount_pct', reward_value: 20, issuance: 'auto', stack_mode: 'one_total', expires_days: null, sort_order: 390 },
];

// ───────────────────────── ENGINEER ─────────────────────────
// Monthly milestone: ONE total (highest tier hit that month). Plus a quarterly
// $1/hour kicker on top. Plus $5 per review left via their invite. All cash, approval.
// Engineer launch is staggered (Cole): June MONTHLY milestones are honored, but
// the quarterly $1/hr kicker resets and starts Jul 1 (so engineers get Q3+Q4 —
// two clean quarters — to work toward). effective_from encodes that per rule.
const ENGINEER: RewardRule[] = [
  { rule_key: 'eng_hours_m_30', track: 'engineer', label: '30 hours run in a month → $150',  counter: 'hours_run',     threshold: 30, window: 'monthly',   reward_type: 'cash_bonus',    reward_value: 150 * DOLLAR, issuance: 'approval', stack_mode: 'one_total',  effective_from: '2026-06-01', sort_order: 410 },
  { rule_key: 'eng_hours_m_60', track: 'engineer', label: '60 hours run in a month → $350',  counter: 'hours_run',     threshold: 60, window: 'monthly',   reward_type: 'cash_bonus',    reward_value: 350 * DOLLAR, issuance: 'approval', stack_mode: 'one_total',  effective_from: '2026-06-01', sort_order: 420 },
  { rule_key: 'eng_hours_q_kicker', track: 'engineer', label: 'Quarterly kicker → $1 per hour run', counter: 'hours_run', threshold: 0, window: 'quarterly', reward_type: 'cash_per_hour', reward_value: 1 * DOLLAR,   issuance: 'approval', stack_mode: 'one_total',  effective_from: '2026-07-01', sort_order: 430, notes: 'On top of monthly; no milestone needed. Resets + starts Jul 1.' },
  { rule_key: 'eng_review_invite', track: 'engineer', label: 'Review left via your invite → $5',    counter: 'review_invite', threshold: 1, window: 'per_event', reward_type: 'cash_bonus',  reward_value: 5 * DOLLAR,   issuance: 'approval', stack_mode: 'cumulative', effective_from: '2026-07-01', sort_order: 440 },
];

// ───────────────────────── PRODUCER ─────────────────────────
// Per year, ONE total (highest tier reached). Bonus from the studio's 40% cut.
const PRODUCER: RewardRule[] = [
  { rule_key: 'prod_rev_500',   track: 'producer', label: '$500 in sales (year) → $35',   counter: 'producer_revenue', threshold: 500 * DOLLAR,   window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 35 * DOLLAR,  issuance: 'approval', stack_mode: 'one_total', sort_order: 510 },
  { rule_key: 'prod_rev_1000',  track: 'producer', label: '$1,000 in sales (year) → $75',  counter: 'producer_revenue', threshold: 1000 * DOLLAR,  window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 75 * DOLLAR,  issuance: 'approval', stack_mode: 'one_total', sort_order: 520 },
  { rule_key: 'prod_rev_2500',  track: 'producer', label: '$2,500 in sales (year) → $175', counter: 'producer_revenue', threshold: 2500 * DOLLAR,  window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 175 * DOLLAR, issuance: 'approval', stack_mode: 'one_total', sort_order: 530 },
  { rule_key: 'prod_rev_5000',  track: 'producer', label: '$5,000 in sales (year) → $350', counter: 'producer_revenue', threshold: 5000 * DOLLAR,  window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 350 * DOLLAR, issuance: 'approval', stack_mode: 'one_total', sort_order: 540 },
  { rule_key: 'prod_rev_10000', track: 'producer', label: '$10,000 in sales (year) → $750',counter: 'producer_revenue', threshold: 10000 * DOLLAR, window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 750 * DOLLAR, issuance: 'approval', stack_mode: 'one_total', sort_order: 550 },
];

// ───────────────────────── MEDIA MANAGER ─────────────────────────
// Per year, ONE total. Bonus from the studio's 35% cut (lower per-tier, higher reach).
const MEDIA_MANAGER: RewardRule[] = [
  { rule_key: 'mm_rev_500',   track: 'media_manager', label: '$500 delivered (year) → $30',    counter: 'media_revenue', threshold: 500 * DOLLAR,   window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 30 * DOLLAR,   issuance: 'approval', stack_mode: 'one_total', sort_order: 610 },
  { rule_key: 'mm_rev_1000',  track: 'media_manager', label: '$1,000 delivered (year) → $70',   counter: 'media_revenue', threshold: 1000 * DOLLAR,  window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 70 * DOLLAR,   issuance: 'approval', stack_mode: 'one_total', sort_order: 620 },
  { rule_key: 'mm_rev_2500',  track: 'media_manager', label: '$2,500 delivered (year) → $150',  counter: 'media_revenue', threshold: 2500 * DOLLAR,  window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 150 * DOLLAR,  issuance: 'approval', stack_mode: 'one_total', sort_order: 630 },
  { rule_key: 'mm_rev_5000',  track: 'media_manager', label: '$5,000 delivered (year) → $300',  counter: 'media_revenue', threshold: 5000 * DOLLAR,  window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 300 * DOLLAR,  issuance: 'approval', stack_mode: 'one_total', sort_order: 640 },
  { rule_key: 'mm_rev_10000', track: 'media_manager', label: '$10,000 delivered (year) → $700', counter: 'media_revenue', threshold: 10000 * DOLLAR, window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 700 * DOLLAR,  issuance: 'approval', stack_mode: 'one_total', sort_order: 650 },
  { rule_key: 'mm_rev_20000', track: 'media_manager', label: '$20,000 delivered (year) → $1,800',counter: 'media_revenue', threshold: 20000 * DOLLAR, window: 'calendar_year', reward_type: 'cash_bonus', reward_value: 1800 * DOLLAR, issuance: 'approval', stack_mode: 'one_total', sort_order: 660 },
];

export const REWARD_RULES: RewardRule[] = [
  ...CUSTOMER_STUDIO_HOURS, ...CUSTOMER_SPEND, ...CUSTOMER_BEAT_SPEND, ...CUSTOMER_MEDIA, ...CUSTOMER_GROWTH,
  ...BAND_HOURS, ...BAND_SPEND,
  ...ENGINEER, ...PRODUCER, ...MEDIA_MANAGER,
];

// ───────────────────────── pure helpers ─────────────────────────

/** Free cutdowns bundled with a music-video purchase: 1 per $250 (floor). */
export function cutdownsForMusicVideo(priceCents: number): number {
  if (!(priceCents > 0)) return 0;
  return Math.floor(priceCents / CUTDOWN_PER_CENTS);
}

/** Better-of, never stack: the single largest discount percent that applies. */
export function bestDiscountPct(percents: number[]): number {
  return percents.reduce((m, p) => (p > m ? p : m), 0);
}

/**
 * The calendar period key for a window at a given instant (UTC date parts).
 * '2026' (year), '2026-Q2' (quarter), '2026-07' (month), 'lifetime'. per_purchase
 * / per_event / one_time carry their own external key (purchase id, etc.).
 */
export function periodKeyFor(window: RewardWindow, d: Date): string {
  const y = d.getUTCFullYear();
  switch (window) {
    case 'calendar_year': return String(y);
    case 'quarterly':     return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case 'monthly':       return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'lifetime':      return 'lifetime';
    default:              return String(y); // per_purchase/per_event/one_time set their own key
  }
}

/** [start, endExclusive) UTC bounds for the calendar window containing `d`. */
export function windowRange(window: RewardWindow, d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  if (window === 'monthly') {
    const m = d.getUTCMonth();
    return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
  }
  if (window === 'quarterly') {
    const q = Math.floor(d.getUTCMonth() / 3);
    return { start: new Date(Date.UTC(y, q * 3, 1)), end: new Date(Date.UTC(y, q * 3 + 3, 1)) };
  }
  // calendar_year (and the default for the rest)
  return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) };
}

export interface RewardedCharge {
  serviceValueCents: number;   // full value of the work — staff are paid on THIS
  customerChargeCents: number; // what the customer actually pays
  depositCents: number;        // 50% of the charge
  discountCents: number;       // best-of discount applied to the paid remainder
  compedBaseCents: number;     // base value of the free hours (comped — surcharges NOT comped)
  rewardsCostCents: number;    // serviceValue - customerCharge = what the studio gave away
}

/**
 * Apply rewards to a session's pricing and return the correct charge split.
 *
 * Cole's rules, encoded:
 *  • Staff are paid on the FULL value of the work → serviceValueCents = the normal total.
 *  • A free hour comps the BASE rate only (the "cheapest"/standard per-hour cost). Surcharges
 *    — same-day, late-night, guest fees — are ALWAYS charged to the customer, even on free hours.
 *  • Partial: N free hours + the remaining hours paid at the normal rate, same booking.
 *  • A discount (%) applies to the paid remainder (best-of, never stacked — caller passes one %).
 *  • rewardsCost = what we gave away = serviceValue − customerCharge (a studio rewards/marketing
 *    cost on a comp; a margin reduction on a discount).
 *
 * `subtotalCents` is the base (pre-surcharge) cost; `totalCents` is the full normal price
 * (base + night/same-day/guest fees) — both from calculateSessionTotal.
 */
export function applyRewardsToPricing(
  p: { totalCents: number; subtotalCents: number },
  totalHours: number,
  opts: { freeHours?: number; discountPct?: number },
): RewardedCharge {
  const freeHours = Math.max(0, Math.min(opts.freeHours ?? 0, totalHours));
  const discountPct = Math.max(0, Math.min(opts.discountPct ?? 0, 100));
  const serviceValueCents = Math.max(0, Math.round(p.totalCents));
  const basePerHour = totalHours > 0 ? p.subtotalCents / totalHours : 0;
  const compedBaseCents = Math.round(basePerHour * freeHours);         // free hours' base only
  const afterFree = Math.max(0, serviceValueCents - compedBaseCents);  // customer still owes surcharges + paid hours
  const discountCents = Math.round(afterFree * (discountPct / 100));
  const customerChargeCents = Math.max(0, afterFree - discountCents);
  const depositCents = Math.round(customerChargeCents * 0.5);
  const rewardsCostCents = serviceValueCents - customerChargeCents;
  return { serviceValueCents, customerChargeCents, depositCents, discountCents, compedBaseCents, rewardsCostCents };
}

/** Money/value of a reward, in cents, for accounting + admin display (0 when not monetary). */
export function rewardValueCents(rule: Pick<RewardRule, 'reward_type' | 'reward_value' | 'reward_cap_cents'>): number {
  switch (rule.reward_type) {
    case 'cash_bonus':
    case 'account_credit_cents':
      return Math.round(rule.reward_value);
    case 'free_music_video':
      return rule.reward_cap_cents ?? 0;
    default:
      return 0; // free_hours/short/photo/discount/status valued at issue time
  }
}
