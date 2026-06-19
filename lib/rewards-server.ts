// lib/rewards-server.ts — server-only reward engine: seed, counter resolvers,
// grant evaluation, and the go-live backfill. NO issuance side-effects yet
// (Phase 1 only RECORDS what's earned in reward_grants; turning an approved
// grant into a studio_credit / media_credit / payroll line is Phase 2/3).
//
// Identity mapping notes (from the real schema):
//  • bookings attribute the customer by `customer_email` (no user_id); band
//    sessions carry `band_id`. So "band hours → band only" = customer counters
//    EXCLUDE rows with a band_id.
//  • engineer = `bookings.engineer_name` (text); media manager = media_sales
//    `filmed_by`/`edited_by` (text); producer = `beats.producer_id` (uuid).
//  • test/comp rows (cole@sweetdreams.us, $0 totals) are excluded from counters.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINEERS } from '@/lib/constants';
import {
  REWARD_RULES, periodKeyFor, windowRange, rewardValueCents,
  type RewardRule, type RewardWindow, type RewardCounter,
} from '@/lib/rewards';

// Exported: the agent stats console (lib/agent-stats-server.ts) excludes the same
// internal test accounts from its work queue + pause emails.
export const TEST_EMAILS = new Set(['cole@sweetdreams.us']);
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Only these windows are evaluable from historical data; per_purchase/per_event/
// one_time rewards are fired by event hooks in later phases, not by sweeps.
const SWEEP_WINDOWS: RewardWindow[] = ['calendar_year', 'monthly', 'quarterly'];

/* eslint-disable @typescript-eslint/no-explicit-any */
// Client is dependency-injected so this module stays free of next/headers and is
// usable from both API routes (pass createServiceClient()) and CLI scripts.
type Client = SupabaseClient<any, any, any>;

export type OwnerRef =
  | { track: 'customer'; userId: string; email: string }
  | { track: 'band'; bandId: string }
  | { track: 'engineer'; engineerName: string; userId?: string }
  | { track: 'producer'; producerId: string; userId?: string }
  | { track: 'media_manager'; name: string; userId?: string };

export interface DesiredGrant {
  rule_key: string;
  track: string;
  counter: string;
  period_key: string;
  threshold: number;
  counter_value: number;
  reward_type: string;
  reward_value: number;
  value_cents: number;
  issuance: string;
  owner_user_id: string | null;
  owner_band_id: string | null;
  label: string;
}

// ───────────────────────── seed ─────────────────────────

/** Upsert the canonical REWARD_RULES into the DB by rule_key (idempotent). */
export async function seedRewardRules(db: Client): Promise<{ upserted: number }> {
  const rows = REWARD_RULES.map((r) => ({
    studio_id: null,
    track: r.track,
    rule_key: r.rule_key,
    label: r.label,
    counter: r.counter,
    threshold: r.threshold,
    window_kind: r.window, // DB column is window_kind ('window' is reserved in Postgres)
    reward_type: r.reward_type,
    reward_value: r.reward_value,
    reward_cap_cents: r.reward_cap_cents ?? null,
    issuance: r.issuance,
    stack_mode: r.stack_mode,
    expires_days: r.expires_days ?? null,
    effective_from: r.effective_from ?? null,
    visible: r.visible ?? true,
    sort_order: r.sort_order,
    active: true,
    notes: r.notes ?? null,
  }));
  const { error } = await db.from('reward_rules').upsert(rows as any, { onConflict: 'rule_key' });
  if (error) throw new Error(`seedRewardRules failed: ${error.message}`);
  return { upserted: rows.length };
}

// ───────────────────────── counter resolvers ─────────────────────────

const iso = (d: Date) => d.toISOString();

const STAFF_TRACKS = new Set(['engineer', 'producer', 'media_manager']);

/** The rewards launch date (staff counters begin here — no back-pay). Null = not set. */
export async function getLaunchDate(db: Client): Promise<Date | null> {
  const { data } = await db.from('reward_settings')
    .select('rewards_launch_date')
    .is('studio_id', null).maybeSingle();
  const v = (data as any)?.rewards_launch_date;
  return v ? new Date(`${v}T00:00:00.000Z`) : null;
}

/**
 * Rough RETAIL value of a reward, for the launch exposure plan (what going live
 * "opens up"). Discounts/status value at $0 here since they depend on future
 * spend. Free work uses retail estimates; cash/credit use their own cents.
 */
export function estimateExposureCents(g: { reward_type: string; reward_value: number; value_cents: number }): number {
  switch (g.reward_type) {
    case 'free_hours':           return Math.round(g.reward_value * 50_00); // ~$50/hr retail
    case 'free_short_video':     return 150_00;
    case 'free_photo_session':   return 200_00;
    case 'free_sweet_spot':      return 2000_00;                            // Band Sweet Spot retail
    case 'free_music_video':     return g.value_cents || 1000_00;           // the cap
    case 'account_credit_cents': return g.value_cents;
    case 'cash_bonus':           return g.value_cents;
    default:                     return 0; // discounts/status/cutdowns: depends on future activity
  }
}

async function customerStudioHours(db: Client, email: string, r: { start: Date; end: Date }): Promise<number> {
  // Customer hours EXCLUDE band sessions (band_id IS NULL) and comped/test rows.
  const { data } = await db.from('bookings')
    .select('duration,total_amount,customer_email')
    .eq('status', 'completed').is('deleted_at', null).is('band_id', null)
    .gte('start_time', iso(r.start)).lt('start_time', iso(r.end))
    .ilike('customer_email', email);
  return (data ?? [])
    .filter((b: any) => (b.total_amount ?? 0) > 0 && !TEST_EMAILS.has(String(b.customer_email || '').toLowerCase()))
    .reduce((s: number, b: any) => s + (Number(b.duration) || 0), 0);
}

async function customerDollarsSpent(db: Client, userId: string, email: string, r: { start: Date; end: Date }): Promise<number> {
  // Studio spend (personal, non-band, completed) + media (paid) + beats (paid).
  const studioQ = db.from('bookings')
    .select('total_amount,customer_email')
    .eq('status', 'completed').is('deleted_at', null).is('band_id', null)
    .gte('start_time', iso(r.start)).lt('start_time', iso(r.end))
    .ilike('customer_email', email);
  const mediaQ = db.from('media_bookings')
    .select('final_price_cents,final_paid_at')
    .eq('user_id', userId)
    .gte('final_paid_at', iso(r.start)).lt('final_paid_at', iso(r.end));
  const beatsQ = db.from('beat_purchases')
    .select('amount_paid,created_at')
    .eq('buyer_id', userId)
    .gte('created_at', iso(r.start)).lt('created_at', iso(r.end));
  const [studio, media, beats] = await Promise.all([studioQ, mediaQ, beatsQ]);
  const studioCents = (studio.data ?? [])
    .filter((b: any) => !TEST_EMAILS.has(String(b.customer_email || '').toLowerCase()))
    .reduce((s: number, b: any) => s + (Number(b.total_amount) || 0), 0);
  const mediaCents = (media.data ?? []).reduce((s: number, b: any) => s + (Number(b.final_price_cents) || 0), 0);
  const beatsCents = (beats.data ?? []).reduce((s: number, b: any) => s + (Number(b.amount_paid) || 0), 0);
  return studioCents + mediaCents + beatsCents;
}

// Strictly BEAT purchases (the separate beat-spend ladder, not the combined dollars_spent).
async function customerBeatSpend(db: Client, userId: string, r: { start: Date; end: Date }): Promise<number> {
  const { data } = await db.from('beat_purchases')
    .select('amount_paid,created_at')
    .eq('buyer_id', userId)
    .gte('created_at', iso(r.start)).lt('created_at', iso(r.end));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).reduce((s: number, b: any) => s + (Number(b.amount_paid) || 0), 0);
}

async function bandStudioHours(db: Client, bandId: string, r: { start: Date; end: Date }): Promise<number> {
  const { data } = await db.from('bookings')
    .select('duration,total_amount')
    .eq('status', 'completed').is('deleted_at', null).eq('band_id', bandId)
    .gte('start_time', iso(r.start)).lt('start_time', iso(r.end));
  return (data ?? [])
    .filter((b: any) => (b.total_amount ?? 0) > 0)
    .reduce((s: number, b: any) => s + (Number(b.duration) || 0), 0);
}

async function bandSpend(db: Client, bandId: string, r: { start: Date; end: Date }): Promise<number> {
  const studioQ = db.from('bookings')
    .select('total_amount')
    .eq('status', 'completed').is('deleted_at', null).eq('band_id', bandId)
    .gte('start_time', iso(r.start)).lt('start_time', iso(r.end));
  const mediaQ = db.from('media_bookings')
    .select('final_price_cents,final_paid_at')
    .eq('band_id', bandId)
    .gte('final_paid_at', iso(r.start)).lt('final_paid_at', iso(r.end));
  const [studio, media] = await Promise.all([studioQ, mediaQ]);
  const studioCents = (studio.data ?? []).reduce((s: number, b: any) => s + (Number(b.total_amount) || 0), 0);
  const mediaCents = (media.data ?? []).reduce((s: number, b: any) => s + (Number(b.final_price_cents) || 0), 0);
  return studioCents + mediaCents;
}

async function engineerHoursRun(db: Client, engineerName: string, r: { start: Date; end: Date }): Promise<number> {
  const { data } = await db.from('bookings')
    .select('duration')
    .eq('status', 'completed').is('deleted_at', null).eq('engineer_name', engineerName)
    .gte('start_time', iso(r.start)).lt('start_time', iso(r.end));
  return (data ?? []).reduce((s: number, b: any) => s + (Number(b.duration) || 0), 0);
}

async function producerRevenue(db: Client, producerId: string, r: { start: Date; end: Date }): Promise<number> {
  const purchasesQ = db.from('beat_purchases')
    .select('amount_paid,created_at,beats!inner(producer_id)')
    .eq('beats.producer_id', producerId)
    .gte('created_at', iso(r.start)).lt('created_at', iso(r.end));
  const privateQ = db.from('private_beat_sales')
    .select('amount,paid_at,producer_id,status')
    .eq('producer_id', producerId).not('paid_at', 'is', null)
    .gte('paid_at', iso(r.start)).lt('paid_at', iso(r.end));
  const [purchases, priv] = await Promise.all([purchasesQ, privateQ]);
  const a = (purchases.data ?? []).reduce((s: number, b: any) => s + (Number(b.amount_paid) || 0), 0);
  const b2 = (priv.data ?? []).reduce((s: number, b: any) => s + (Number(b.amount) || 0), 0);
  return a + b2;
}

async function mediaRevenue(db: Client, name: string, r: { start: Date; end: Date }): Promise<number> {
  const { data } = await db.from('media_sales')
    .select('amount,sale_amount,filmed_by,edited_by,created_at')
    .or(`filmed_by.eq.${name},edited_by.eq.${name}`)
    .gte('created_at', iso(r.start)).lt('created_at', iso(r.end));
  return (data ?? []).reduce((s: number, b: any) => s + (Number(b.sale_amount ?? b.amount) || 0), 0);
}

/** Resolve one counter for an owner within a window range. */
async function resolveCounter(db: Client, counter: RewardCounter, owner: OwnerRef, r: { start: Date; end: Date }): Promise<number> {
  switch (counter) {
    case 'studio_hours':     return owner.track === 'customer' ? customerStudioHours(db, owner.email, r) : 0;
    case 'dollars_spent':    return owner.track === 'customer' ? customerDollarsSpent(db, owner.userId, owner.email, r) : 0;
    case 'beat_spend':       return owner.track === 'customer' ? customerBeatSpend(db, owner.userId, r) : 0;
    case 'band_hours':       return owner.track === 'band' ? bandStudioHours(db, owner.bandId, r) : 0;
    case 'band_spend':       return owner.track === 'band' ? bandSpend(db, owner.bandId, r) : 0;
    case 'hours_run':        return owner.track === 'engineer' ? engineerHoursRun(db, owner.engineerName, r) : 0;
    case 'producer_revenue': return owner.track === 'producer' ? producerRevenue(db, owner.producerId, r) : 0;
    case 'media_revenue':    return owner.track === 'media_manager' ? mediaRevenue(db, owner.name, r) : 0;
    default:                 return 0; // event-driven counters aren't swept
  }
}

/** Current calendar-year counter values for a customer (for progress bars). */
export async function customerProgress(db: Client, userId: string, email: string, now: Date): Promise<Record<string, number>> {
  const r = windowRange('calendar_year', now);
  const [studio_hours, dollars_spent, beat_spend] = await Promise.all([
    customerStudioHours(db, email, r),
    customerDollarsSpent(db, userId, email, r),
    customerBeatSpend(db, userId, r),
  ]);
  return { studio_hours, dollars_spent, beat_spend };
}

/**
 * Engineer hours run this month + this quarter, clamped to the launch date so
 * pre-launch work is never counted (no back-pay). Powers the engineer bonus card.
 */
export async function engineerProgress(db: Client, engineerName: string, now: Date, launchDate: Date | null): Promise<{ monthHours: number; quarterHours: number }> {
  const m = windowRange('monthly', now);
  const q = windowRange('quarterly', now);
  // Per-window effective dates: monthly = Jun 1 (June bonuses honored), quarterly
  // = Jul 1 (kicker resets, two clean quarters). Falls back to the global launch.
  const eff = (win: string) => {
    const r = REWARD_RULES.find((x) => x.track === 'engineer' && x.window === win);
    return r?.effective_from ? new Date(`${r.effective_from}T00:00:00.000Z`) : launchDate;
  };
  const mClamp = eff('monthly'); const qClamp = eff('quarterly');
  if (mClamp && mClamp > m.start) m.start = mClamp;
  if (qClamp && qClamp > q.start) q.start = qClamp;
  const [monthHours, quarterHours] = await Promise.all([
    engineerHoursRun(db, engineerName, m),
    engineerHoursRun(db, engineerName, q),
  ]);
  return { monthHours, quarterHours };
}

/** Producer beat revenue (calendar year) for standings. producerId = profiles.id. */
export async function producerProgress(db: Client, producerId: string, now: Date): Promise<number> {
  return producerRevenue(db, producerId, windowRange('calendar_year', now));
}

/** Media worker revenue (film+edit, calendar year) for standings. name = filmed_by/edited_by. */
export async function mediaManagerProgress(db: Client, name: string, now: Date): Promise<number> {
  return mediaRevenue(db, name, windowRange('calendar_year', now));
}

/** Current calendar-year counter values for a band. */
export async function bandProgress(db: Client, bandId: string, now: Date): Promise<Record<string, number>> {
  const r = windowRange('calendar_year', now);
  const [band_hours, band_spend] = await Promise.all([
    bandStudioHours(db, bandId, r),
    bandSpend(db, bandId, r),
  ]);
  return { band_hours, band_spend };
}

// ───────────────────────── evaluation ─────────────────────────

function ownerCols(owner: OwnerRef): { owner_user_id: string | null; owner_band_id: string | null } {
  if (owner.track === 'band') return { owner_user_id: null, owner_band_id: owner.bandId };
  if (owner.track === 'customer') return { owner_user_id: owner.userId, owner_band_id: null };
  return { owner_user_id: owner.userId ?? null, owner_band_id: null }; // staff
}

/**
 * Compute the grants an owner has earned right now. Pure read — returns the
 * DESIRED grants; persistence is separate. Handles one_total (highest tier),
 * cumulative (every rung), and the engineer cash_per_hour kicker.
 */
export async function evaluateOwner(db: Client, owner: OwnerRef, now: Date, launchDate: Date | null = null): Promise<DesiredGrant[]> {
  const rules = REWARD_RULES.filter((r) => r.track === owner.track && SWEEP_WINDOWS.includes(r.window));
  const cols = ownerCols(owner);
  const clampStaff = STAFF_TRACKS.has(owner.track) && !!launchDate;

  // Group by (counter + window) so one_total can pick a single winner per group.
  const groups = new Map<string, RewardRule[]>();
  for (const r of rules) {
    const k = `${r.counter}|${r.window}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const out: DesiredGrant[] = [];
  for (const [, groupRules] of groups) {
    const sample = groupRules[0];
    const range = windowRange(sample.window, now);
    // Clamp the window start to when this rule actually starts counting: a per-rule
    // effective_from wins (e.g. engineer quarterly kicker = Jul 1); else staff fall
    // back to the global launch date (no back-pay); customers/bands look all the way
    // back (no clamp — their counter is progress, granted tiers handled separately).
    const effFrom = sample.effective_from
      ? new Date(`${sample.effective_from}T00:00:00.000Z`)
      : (clampStaff ? launchDate : null);
    if (effFrom && effFrom > range.start) range.start = effFrom;
    const value = await resolveCounter(db, sample.counter, owner, range);
    if (!(value > 0)) continue;
    const period_key = periodKeyFor(sample.window, now);

    // Special: per-hour kicker (threshold 0, value = counter * rate).
    const kicker = groupRules.find((r) => r.reward_type === 'cash_per_hour');
    if (kicker) {
      out.push(mkGrant(kicker, owner, cols, period_key, value, Math.round(value * kicker.reward_value)));
      continue;
    }

    const reached = groupRules.filter((r) => r.threshold > 0 && value >= r.threshold);
    if (reached.length === 0) continue;

    const oneTotal = groupRules.some((r) => r.stack_mode === 'one_total');
    const granted = oneTotal
      ? [reached.reduce((hi, r) => (r.threshold > hi.threshold ? r : hi), reached[0])]
      : reached;

    for (const r of granted) out.push(mkGrant(r, owner, cols, period_key, value, rewardValueCents(r)));
  }
  return out;
}

function mkGrant(
  r: RewardRule, owner: OwnerRef, cols: { owner_user_id: string | null; owner_band_id: string | null },
  period_key: string, counter_value: number, value_cents: number,
): DesiredGrant {
  return {
    rule_key: r.rule_key, track: r.track, counter: r.counter, period_key,
    threshold: r.threshold, counter_value, reward_type: r.reward_type, reward_value: r.reward_value,
    value_cents, issuance: r.issuance, owner_user_id: cols.owner_user_id, owner_band_id: cols.owner_band_id,
    label: r.label,
  };
}

/**
 * Persist desired grants (insert-if-absent by the dedup key). Auto rewards land
 * 'approved' (ready for the Phase-2 issuer); approval rewards 'pending_approval'.
 * Returns how many new grants were written. Skips rows with no owner id.
 */
export async function persistGrants(db: Client, grants: DesiredGrant[], source = 'evaluate', opts: { statusOverride?: string } = {}): Promise<{ inserted: number; skipped: number }> {
  if (grants.length === 0) return { inserted: 0, skipped: 0 };

  // Map rule_key -> rule id (one fetch).
  const { data: ruleRows } = await db.from('reward_rules').select('id,rule_key');
  const ruleId = new Map<string, string>((ruleRows ?? []).map((r: any) => [r.rule_key, r.id]));

  let inserted = 0, skipped = 0;
  for (const g of grants) {
    const rid = ruleId.get(g.rule_key);
    if (!rid || (!g.owner_user_id && !g.owner_band_id)) { skipped++; continue; }

    // Dedup: existing grant for (rule, owner, period)?
    const existing = await db.from('reward_grants').select('id')
      .eq('rule_id', rid).eq('period_key', g.period_key)
      .eq('owner_user_id', g.owner_user_id ?? ZERO_UUID)
      .eq('owner_band_id', g.owner_band_id ?? ZERO_UUID)
      .maybeSingle();
    if (existing.data) { skipped++; continue; }

    const { error } = await db.from('reward_grants').insert({
      studio_id: null, rule_id: rid, rule_key: g.rule_key,
      owner_user_id: g.owner_user_id, owner_band_id: g.owner_band_id,
      track: g.track, counter: g.counter,
      status: opts.statusOverride ?? (g.issuance === 'auto' ? 'approved' : 'pending_approval'),
      period_key: g.period_key, threshold: g.threshold, counter_value: g.counter_value,
      reward_type: g.reward_type, reward_value: g.reward_value, value_cents: g.value_cents,
      issuance: g.issuance, metadata: { source, label: g.label },
    } as any);
    if (error) { skipped++; continue; }
    inserted++;
  }
  return { inserted, skipped };
}

// ───────────────────────── event-driven grants ─────────────────────────

/**
 * Grant an EVENT-DRIVEN reward (the per_event / one_time / per_purchase rules the
 * window sweeps skip — see SWEEP_WINDOWS). Fired by hooks when the real thing
 * happens (e.g. a profile is completed → 'cust_profile_complete'). Reuses the same
 * rule→grant shape as persistGrants/mkGrant + the same status mapping:
 *   • issuance 'auto'     → 'approved' (ready for the issuer)
 *   • issuance 'approval' → 'pending_approval' (admin approves, then it issues)
 *
 * Idempotent. For a one_total / one_time rule it is ONE PER OWNER for all time:
 * we use a fixed 'one_time' period_key AND first check whether the owner already
 * holds ANY grant for this rule_key (any status/period) before inserting, so the
 * free hour is granted exactly once per real person. Cumulative/per_event rules
 * can pass a distinct `periodKey` (e.g. a purchase/referral id) to allow repeats.
 *
 * Returns whether a new grant was created (false = already had one / no-op).
 */
export async function grantEventReward(
  db: Client,
  rule_key: string,
  owner: { userId: string | null; bandId?: string | null },
  opts: { periodKey?: string; counterValue?: number; source?: string } = {},
): Promise<{ created: boolean; reason?: string }> {
  const rule = REWARD_RULES.find((r) => r.rule_key === rule_key);
  if (!rule) return { created: false, reason: 'unknown rule_key' };

  const owner_user_id = owner.userId ?? null;
  const owner_band_id = owner.bandId ?? null;
  if (!owner_user_id && !owner_band_id) return { created: false, reason: 'no owner' };

  // rule id (the grant FKs the rule).
  const { data: ruleRow } = await db.from('reward_rules').select('id').eq('rule_key', rule_key).maybeSingle();
  const rid = (ruleRow as any)?.id;
  if (!rid) return { created: false, reason: 'rule not seeded' };

  const isOnce = rule.stack_mode === 'one_total' || rule.window === 'one_time';
  // one_time → a single fixed period so it can never recur across years; otherwise
  // the caller's key, falling back to this window's calendar period.
  const period_key = isOnce ? 'one_time' : (opts.periodKey ?? periodKeyFor(rule.window, new Date()));

  // Idempotency / one-per-person guard. For a once rule, ANY existing grant of this
  // rule for the owner blocks a re-grant (honors one_total across all periods).
  let existQ = db.from('reward_grants').select('id').eq('rule_key', rule_key);
  if (owner_band_id) existQ = existQ.eq('owner_band_id', owner_band_id);
  else existQ = existQ.eq('owner_user_id', owner_user_id);
  if (!isOnce) existQ = existQ.eq('period_key', period_key); // repeatable rules dedup per period
  const { data: existing } = await existQ.limit(1).maybeSingle();
  if (existing) return { created: false, reason: 'already granted' };

  const { error } = await db.from('reward_grants').insert({
    studio_id: null, rule_id: rid, rule_key,
    owner_user_id, owner_band_id,
    track: rule.track, counter: rule.counter,
    status: rule.issuance === 'auto' ? 'approved' : 'pending_approval',
    period_key, threshold: rule.threshold, counter_value: opts.counterValue ?? rule.threshold,
    reward_type: rule.reward_type, reward_value: rule.reward_value, value_cents: rewardValueCents(rule),
    issuance: rule.issuance, metadata: { source: opts.source ?? 'event', label: rule.label },
  } as any);
  // A concurrent insert can lose the (rule,owner,period) unique index race; that's
  // still the idempotent outcome we want, so treat a duplicate as "not created".
  if (error) return { created: false, reason: error.message };
  return { created: true };
}

// ───────────────────────── go-live backfill ─────────────────────────

export interface BackfillReport {
  dryRun: boolean;
  customers: number;
  bands: number;
  grantsFound: number;
  grantsInserted: number;
  sample: Array<{ owner: string; label: string; counter_value: number; period: string }>;
  // Launch exposure plan: what going live would open up, by reward type + est. retail $.
  exposure: { byType: Record<string, { count: number; estCents: number }>; totalEstCents: number };
}

function accExposure(report: BackfillReport, g: DesiredGrant) {
  const est = estimateExposureCents(g);
  const b = (report.exposure.byType[g.reward_type] ??= { count: 0, estCents: 0 });
  b.count++; b.estCents += est; report.exposure.totalEstCents += est;
}

/**
 * Backfill the CURRENT calendar year's customer + band loyalty grants from real
 * history ("give people points for what they've done"). Staff bonus backfill is
 * intentionally out of scope here (those reconcile via payroll, Phase 4).
 * dryRun=true computes + reports without writing.
 */
export interface StaffSweepReport { dryRun: boolean; evaluated: number; found: number; inserted: number; sample: Array<{ person: string; label: string; valueCents: number; period: string }>; }

/**
 * Sweep engineer cash bonuses: evaluate each roster engineer's hours_run for the
 * current month + quarter (clamped to effective_from — June monthly / Jul 1 quarterly)
 * and create pending_approval cash_bonus grants. Admin approves → they add to payroll.
 * Idempotent per (rule, owner, period). Producers/media-managers are a follow-up (their
 * identity mapping — producer_id / filmed_by name — is fuzzier than the engineer roster).
 */
export async function sweepStaffBonuses(db: Client, now: Date, opts: { dryRun?: boolean } = {}): Promise<StaffSweepReport> {
  const dryRun = opts.dryRun ?? true;
  const launchDate = await getLaunchDate(db);
  const report: StaffSweepReport = { dryRun, evaluated: 0, found: 0, inserted: 0, sample: [] };

  // Map engineer roster email → user_id (case-insensitive).
  const { data: profs } = await db.from('profiles').select('user_id,email').not('email', 'is', null);
  const userByEmail = new Map<string, string>();
  for (const p of (profs ?? []) as any[]) if (p.email && p.user_id) userByEmail.set(String(p.email).toLowerCase(), p.user_id);

  for (const e of ENGINEERS) {
    const userId = userByEmail.get(e.email.toLowerCase());
    if (!userId) continue;
    report.evaluated++;
    const grants = await evaluateOwner(db, { track: 'engineer', engineerName: e.name, userId }, now, launchDate);
    report.found += grants.length;
    if (!dryRun) { const r = await persistGrants(db, grants, 'staff-sweep'); report.inserted += r.inserted; }
    for (const g of grants) if (report.sample.length < 20) report.sample.push({ person: e.name, label: g.label, valueCents: g.value_cents, period: g.period_key });
  }
  return report;
}

export async function backfillCustomersAndBands(db: Client, now: Date, opts: { dryRun?: boolean; baseline?: boolean } = {}): Promise<BackfillReport> {
  const dryRun = opts.dryRun ?? true;
  // Progress-only launch (Cole): record already-reached tiers as 'baseline' so
  // they're NOT issued and never re-granted, but the customer's progress is kept.
  // The old "book 3hrs → free short" deal already gave the value, so we don't
  // re-gift it. (baseline=false would instead queue them pending for approval.)
  const statusOverride = (opts.baseline ?? true) ? 'baseline' : undefined;
  const report: BackfillReport = { dryRun, customers: 0, bands: 0, grantsFound: 0, grantsInserted: 0, sample: [], exposure: { byType: {}, totalEstCents: 0 } };

  // Customers: distinct paying emails with a completed personal (non-band) session.
  const { data: bookingRows } = await db.from('bookings')
    .select('customer_email')
    .eq('status', 'completed').is('deleted_at', null).is('band_id', null)
    .gt('total_amount', 0);
  const emails = Array.from(new Set(
    (bookingRows ?? [])
      .map((b: any) => String(b.customer_email || '').toLowerCase())
      .filter((e: string) => e && !TEST_EMAILS.has(e)),
  ));

  // Map emails -> user_id via profiles (needed to own a grant).
  const { data: profs } = await db.from('profiles').select('user_id,email').not('email', 'is', null);
  const userByEmail = new Map<string, string>();
  for (const p of (profs ?? []) as any[]) {
    if (p.email && p.user_id) userByEmail.set(String(p.email).toLowerCase(), p.user_id);
  }

  for (const email of emails) {
    const userId = userByEmail.get(email);
    if (!userId) continue; // guest/no-account bookings can't own a grant yet
    report.customers++;
    const grants = await evaluateOwner(db, { track: 'customer', userId, email }, now);
    report.grantsFound += grants.length;
    if (!dryRun) {
      const res = await persistGrants(db, grants, 'backfill', { statusOverride });
      report.grantsInserted += res.inserted;
    }
    for (const g of grants) {
      accExposure(report, g);
      if (report.sample.length < 20) report.sample.push({ owner: email, label: g.label, counter_value: g.counter_value, period: g.period_key });
    }
  }

  // Bands.
  const { data: bands } = await db.from('bands').select('id,display_name');
  for (const band of bands ?? []) {
    report.bands++;
    const grants = await evaluateOwner(db, { track: 'band', bandId: (band as any).id }, now);
    report.grantsFound += grants.length;
    if (!dryRun) {
      const res = await persistGrants(db, grants, 'backfill', { statusOverride });
      report.grantsInserted += res.inserted;
    }
    for (const g of grants) {
      accExposure(report, g);
      if (report.sample.length < 20) report.sample.push({ owner: `band:${(band as any).display_name}`, label: g.label, counter_value: g.counter_value, period: g.period_key });
    }
  }

  return report;
}
