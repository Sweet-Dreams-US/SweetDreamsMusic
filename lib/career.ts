// lib/career.ts — Career Development Path pure core (Plan 6). No DB, no next/*.
//
// Two tracks:
//  - CAREER STAGES (1-5): what you've done. Stage = highest stage where ALL
//    requirements are complete. Computed, never self-selected.
//  - LISTENER TIERS: how big you are. Permanent certifications granted on two
//    consecutive verified weekly snapshots ≥ threshold (neither anomalous).
//
// Standing rules: XP is status only, never spendable. Auto-verified = heavy
// XP, semi medium, honor confirmations light. Advice never blocks.

// ── Listener tiers ────────────────────────────────────────────────────────────

export const TIER_LADDER = [
  10_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000,
] as const;
export type ListenerTier = (typeof TIER_LADDER)[number];

/** Numeric naming only — never Gold/Platinum/Diamond (reads as RIAA). */
export function tierLabel(tier: number): string {
  if (tier >= 1_000_000) return `${tier / 1_000_000}M Club`;
  return `${Math.round(tier / 1000)}K Club`;
}

/** Tiers needing the in-person plaque prompt to studio admins. */
export const PLAQUE_TIER_MIN = 100_000;

/** Consecutive-snapshot tolerance: weekly anchor-day cadence can stretch after
 *  a missed week; ≤13 days apart still counts as consecutive weeks. */
export const CONSECUTIVE_MAX_DAYS = 13;

export interface TierSnapshot {
  id: string;
  metricDate: string;          // YYYY-MM-DD
  monthlyListeners: number;
  anomaly: boolean;
}

/**
 * Highest tier provable from the two MOST RECENT verified snapshots.
 * Both ≥ threshold, neither anomalous, ≤ CONSECUTIVE_MAX_DAYS apart.
 * A single spike can never grant; an anomaly-flagged pair can never grant.
 */
export function tierFromSnapshots(latest: TierSnapshot | null, prev: TierSnapshot | null): ListenerTier | null {
  if (!latest || !prev) return null;
  if (latest.anomaly || prev.anomaly) return null;
  const gap = daysBetweenIso(prev.metricDate, latest.metricDate);
  if (gap < 1 || gap > CONSECUTIVE_MAX_DAYS) return null;
  const floor = Math.min(latest.monthlyListeners, prev.monthlyListeners);
  let granted: ListenerTier | null = null;
  for (const t of TIER_LADDER) if (floor >= t) granted = t;
  return granted;
}

export function daysBetweenIso(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// ── Rollout score (0-100) ────────────────────────────────────────────────────

export interface RolloutInputs {
  releaseDateSetDaysAhead: number | null; // days between date-set moment and target date (null = no date)
  hasCoverArt: boolean;
  photoshootBooked: boolean;              // media booking linked to project (or user window)
  videoBookedOrLinked: boolean;
  hasPresave: boolean;
  preReleaseContentCount: number;         // calendar entries in the 14 days before release
  shareLinkPlays: number;                 // plays on this project's private links pre-release
  hasAdBudget: boolean;
  postReleaseContentCount: number;        // calendar entries in the 7 days after release
}

export const ROLLOUT_ITEMS = [
  { key: 'date_ahead',   label: 'Release date set 21+ days ahead', weight: 20 },
  { key: 'cover_art',    label: 'Cover art uploaded',              weight: 10 },
  { key: 'photoshoot',   label: 'Photoshoot booked',               weight: 10 },
  { key: 'video',        label: 'Video booked or linked',          weight: 10 },
  { key: 'presave',      label: 'Pre-save link added',             weight: 10 },
  { key: 'pre_content',  label: '6+ content posts planned in the 2 weeks before release', weight: 15 },
  { key: 'share_plays',  label: 'Private link sent, 5+ listens pre-release', weight: 10 },
  { key: 'ad_budget',    label: 'Ad budget set (any amount)',      weight: 5 },
  { key: 'week_one',     label: 'Week-one post-release content logged', weight: 10 },
] as const;
export type RolloutItemKey = (typeof ROLLOUT_ITEMS)[number]['key'];

export const RUSHED_RELEASE_DAYS = 14;   // under this → non-blocking "rushed" banner

export function computeRolloutScore(inp: RolloutInputs): { score: number; breakdown: Record<RolloutItemKey, boolean> } {
  const met: Record<RolloutItemKey, boolean> = {
    date_ahead: inp.releaseDateSetDaysAhead != null && inp.releaseDateSetDaysAhead >= 21,
    cover_art: inp.hasCoverArt,
    photoshoot: inp.photoshootBooked,
    video: inp.videoBookedOrLinked,
    presave: inp.hasPresave,
    pre_content: inp.preReleaseContentCount >= 6,
    share_plays: inp.shareLinkPlays >= 5,
    ad_budget: inp.hasAdBudget,
    week_one: inp.postReleaseContentCount >= 1,
  };
  const score = ROLLOUT_ITEMS.reduce((s, item) => s + (met[item.key] ? item.weight : 0), 0);
  return { score, breakdown: met };
}

/** Release XP scales with rollout: base × score/100, floor 25% of base. */
export function releaseXp(baseXp: number, rolloutScore: number): number {
  return Math.round(baseXp * Math.max(0.25, Math.min(100, rolloutScore) / 100));
}

// ── Career stage requirement catalog (seed source of truth) ─────────────────

export type VerifyType = 'auto' | 'semi' | 'confirm' | 'playbook';

export interface RequirementDef {
  stage: 1 | 2 | 3 | 4 | 5;
  key: string;
  title: string;
  description: string;
  verifyType: VerifyType;
  /** machine spec: { check: <check id in career-rules>, ...params } */
  rule?: Record<string, unknown>;
  confirmFields?: { key: string; label: string; type: 'text' | 'number' | 'url' }[];
  /** playbook: section id + item indexes that must all be read */
  playbook?: { section: string; items: number[] };
  xp: number;
  sort: number;
}

export const STAGE_NAMES: Record<number, string> = {
  1: 'Foundation', 2: 'Catalog', 3: 'Audience', 4: 'Monetizing', 5: 'Professional',
};

export const REQUIREMENTS: RequirementDef[] = [
  // ── Stage 1 — Foundation ──
  { stage: 1, key: 's1_links',    title: 'Connect 4+ platform links', description: 'Link your Spotify, Instagram, TikTok, YouTube — wherever you live online — so the studio can track your growth.', verifyType: 'auto', rule: { check: 'platform_links', min: 4 }, xp: 60, sort: 1 },
  { stage: 1, key: 's1_session',  title: 'Complete your first session', description: 'Book and finish a session at the studio.', verifyType: 'auto', rule: { check: 'completed_sessions', min: 1 }, xp: 100, sort: 2 },
  { stage: 1, key: 's1_budget',   title: 'Set a monthly music budget', description: 'Decide what you can put into your music every month — any amount counts.', verifyType: 'confirm', confirmFields: [{ key: 'amount', label: 'Monthly budget ($)', type: 'number' }], xp: 10, sort: 3 },
  { stage: 1, key: 's1_brand',    title: 'Complete your brand basics', description: 'Profile photo and bio filled in.', verifyType: 'auto', rule: { check: 'profile_brand' }, xp: 50, sort: 4 },
  { stage: 1, key: 's1_show_fan', title: 'Attend a local show as a fan', description: 'Go watch live music in your city. Pay attention to what works.', verifyType: 'confirm', confirmFields: [{ key: 'venue', label: 'Venue', type: 'text' }, { key: 'who_met', label: 'Who did you meet?', type: 'text' }], xp: 10, sort: 5 },
  { stage: 1, key: 's1_playbook', title: 'Read: The Reality Check + Budgeting', description: 'Two short reads that save years.', verifyType: 'playbook', playbook: { section: 'foundation', items: [0, 1] }, xp: 15, sort: 6 },

  // ── Stage 2 — Catalog ──
  { stage: 2, key: 's2_release',  title: 'First release live', description: 'A released project with a public release page.', verifyType: 'auto', rule: { check: 'released_projects', min: 1 }, xp: 150, sort: 1 },
  { stage: 2, key: 's2_sessions', title: '3 completed sessions', description: 'Reps in the studio.', verifyType: 'auto', rule: { check: 'completed_sessions', min: 3 }, xp: 100, sort: 2 },
  { stage: 2, key: 's2_singles',  title: '3 singles before any album', description: 'Singles build followings — albums reward them.', verifyType: 'auto', rule: { check: 'singles_before_album', min: 3 }, xp: 120, sort: 3 },
  { stage: 2, key: 's2_share',    title: 'Share an unreleased track, get 3 pieces of feedback', description: 'Send a private listening link; collect 3 responses.', verifyType: 'auto', rule: { check: 'share_feedback', min: 3 }, xp: 80, sort: 4 },
  { stage: 2, key: 's2_rollout',  title: 'Score 60+ on a release rollout', description: 'Plan a release properly — the score shows you how.', verifyType: 'auto', rule: { check: 'rollout_at_least', score: 60 }, xp: 100, sort: 5 },
  { stage: 2, key: 's2_prep',     title: 'Prep a session with a reference track', description: 'Upload or link a reference before a session.', verifyType: 'auto', rule: { check: 'session_prep_reference' }, xp: 60, sort: 6 },
  { stage: 2, key: 's2_playbook', title: 'Read: Release Strategy + In the Studio + Mixing & Mastering', description: '', verifyType: 'playbook', playbook: { section: 'creating', items: [0, 1, 2] }, xp: 15, sort: 7 },

  // ── Stage 3 — Audience ──
  { stage: 3, key: 's3_listeners', title: '500 monthly listeners', description: 'Verified by your weekly tracked stats.', verifyType: 'auto', rule: { check: 'monthly_listeners', min: 500 }, xp: 150, sort: 1 },
  { stage: 3, key: 's3_streak',    title: '4 consecutive weeks of tracked stats', description: 'Consistency is the metric behind the metrics.', verifyType: 'auto', rule: { check: 'snapshot_streak_weeks', weeks: 4 }, xp: 80, sort: 2 },
  { stage: 3, key: 's3_shows',     title: 'Perform 2 live shows', description: 'Booked on your calendar ahead of time, confirmed after with a photo.', verifyType: 'semi', rule: { check: 'shows_performed', min: 2 }, xp: 120, sort: 3 },
  { stage: 3, key: 's3_network',   title: 'Log 3 creatives you\'ve met at your level', description: 'Artists, producers, videographers — your future team.', verifyType: 'confirm', rule: { check: 'contacts_logged', min: 3 }, xp: 15, sort: 4 },
  { stage: 3, key: 's3_list',      title: 'Start your email/text list', description: 'Owned audience beats rented audience.', verifyType: 'confirm', confirmFields: [{ key: 'platform', label: 'Platform (Mailchimp, Laylo…)', type: 'text' }, { key: 'subscriber_count', label: 'Subscribers so far', type: 'number' }], xp: 15, sort: 5 },
  { stage: 3, key: 's3_playbook',  title: 'Read: Growing Your Audience', description: '', verifyType: 'playbook', playbook: { section: 'growing', items: [0, 1, 2, 3] }, xp: 15, sort: 6 },

  // ── Stage 4 — Monetizing ──
  { stage: 4, key: 's4_collab',    title: 'First collab release', description: 'A released project with a collaborator on it.', verifyType: 'auto', rule: { check: 'collab_release' }, xp: 150, sort: 1 },
  { stage: 4, key: 's4_shows',     title: '5 shows performed, 1+ paid', description: '', verifyType: 'semi', rule: { check: 'shows_performed', min: 5, paidMin: 1 }, xp: 150, sort: 2 },
  { stage: 4, key: 's4_listeners', title: '2,500 monthly listeners', description: '', verifyType: 'auto', rule: { check: 'monthly_listeners', min: 2500 }, xp: 200, sort: 3 },
  { stage: 4, key: 's4_rollout',   title: 'Score 85+ on a release rollout', description: '', verifyType: 'auto', rule: { check: 'rollout_at_least', score: 85 }, xp: 150, sort: 4 },
  { stage: 4, key: 's4_product',   title: 'Merch or paid product live', description: 'Anything fans can buy.', verifyType: 'confirm', confirmFields: [{ key: 'link', label: 'Link to your product', type: 'url' }], xp: 15, sort: 5 },
  { stage: 4, key: 's4_playbook',  title: 'Read: Monetizing Your Art', description: '', verifyType: 'playbook', playbook: { section: 'monetizing', items: [0, 1, 2] }, xp: 15, sort: 6 },

  // ── Stage 5 — Professional ──
  { stage: 5, key: 's5_listeners',  title: '10,000 monthly listeners', description: '', verifyType: 'auto', rule: { check: 'monthly_listeners', min: 10000 }, xp: 300, sort: 1 },
  { stage: 5, key: 's5_cadence',    title: '6 releases in 12 months', description: 'Professional output, sustained.', verifyType: 'auto', rule: { check: 'releases_in_12mo', min: 6 }, xp: 200, sort: 2 },
  { stage: 5, key: 's5_headline',   title: 'Headline or co-headline a show', description: '', verifyType: 'semi', rule: { check: 'headline_show' }, xp: 150, sort: 3 },
  { stage: 5, key: 's5_registered', title: 'Register: PRO + SoundExchange + distributor', description: 'Collect every dollar your music earns.', verifyType: 'confirm', confirmFields: [{ key: 'pro_org', label: 'PRO (BMI/ASCAP/SESAC)', type: 'text' }, { key: 'soundexchange', label: 'SoundExchange account', type: 'text' }, { key: 'distributor', label: 'Distributor', type: 'text' }], xp: 20, sort: 4 },
  { stage: 5, key: 's5_playbook',   title: 'Read: Scaling Your Career', description: '', verifyType: 'playbook', playbook: { section: 'scaling', items: [0, 1, 2] }, xp: 15, sort: 5 },
];

/** Stage = highest stage N where ALL stages 1..N requirements are complete. */
export function computeStage(completedKeys: Set<string>, reqs: Pick<RequirementDef, 'stage' | 'key'>[] = REQUIREMENTS): number {
  let stage = 0;
  for (let s = 1; s <= 5; s++) {
    const stageReqs = reqs.filter((r) => r.stage === s);
    if (stageReqs.length === 0) break;
    if (!stageReqs.every((r) => completedKeys.has(r.key))) break;
    stage = s;
  }
  return stage; // 0 = pre-Stage-1 (brand new)
}

export function stageDisplay(stage: number): string {
  if (stage <= 0) return 'Getting Started';
  return `Stage ${stage} — ${STAGE_NAMES[stage]}`;
}

// ── Share-link validity (the listen route's gate; pure for the golden test) ──

export function shareLinkInvalidReason(link: { revoked: boolean; expires_at: string | null }, now: Date = new Date()):
  'revoked' | 'expired' | null {
  if (link.revoked) return 'revoked';
  if (link.expires_at && new Date(link.expires_at) < now) return 'expired';
  return null;
}

// ── Achievement keys granted by this engine ──────────────────────────────────

export const CAREER_ACHIEVEMENTS = {
  stages: { 2: 'stage_2_catalog', 3: 'stage_3_audience', 4: 'stage_4_monetizing', 5: 'stage_5_professional' } as Record<number, string>,
  tiers: Object.fromEntries(TIER_LADDER.map((t) => [t, `tier_${t >= 1_000_000 ? `${t / 1_000_000}m` : `${t / 1000}k`}`])) as Record<number, string>,
  shows: { first: 'first_show', five: 'five_shows', paid: 'first_paid_show', headline: 'first_headline' },
  rollout: { r60: 'rollout_60', r85: 'rollout_85', r100: 'rollout_perfect' },
  sharing: { firstLink: 'first_share_link', feedback10: 'feedback_x10', party: 'listening_party' },
  consistency: { streak4: 'four_week_streak', sixReleases: 'six_releases_year', collab: 'first_collab' },
} as const;
