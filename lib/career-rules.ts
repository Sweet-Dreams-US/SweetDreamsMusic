// lib/career-rules.ts — the career engine's shared spine (Plan 6 §6).
//
// ONE evaluation module, two consumers:
//  - evaluateGates(db, userId): computes requirement_progress for auto/semi
//    rules. Called from event hooks (booking completed, snapshot written,
//    project released, feedback received, …) + the nightly sweep cron.
//  - nextSteps(ctx): priority-ordered advice rules reading the SAME state
//    checks, surfacing the top undone actions on the overview.
//
// Client-injected db (service client) so routes AND tsx scripts share it.
// Advice never blocks. Lying about an open mic earns 10 XP and moves nothing;
// hitting 500 verified listeners moves your stage.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REQUIREMENTS, computeStage, stageDisplay, CAREER_ACHIEVEMENTS,
  TIER_LADDER, tierLabel, tierFromSnapshots, PLAQUE_TIER_MIN,
  daysBetweenIso, CONSECUTIVE_MAX_DAYS, type TierSnapshot,
} from '@/lib/career';
import { grantAchievement } from '@/lib/achievements-server';
import { awardXP } from '@/lib/xp-system';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

// ── State context: every fact the rules read, gathered once ─────────────────

export interface CareerContext {
  userId: string;
  email: string | null;
  platformLinkCount: number;
  completedSessions: number;
  brandComplete: boolean;
  releasedProjects: { id: string; projectType: string; releasedAt: string | null; slug: string | null }[];
  releasedSingles: number;
  albumReleasedBeforeSingles: boolean;   // an album/EP released before 3 singles existed
  maxRolloutScore: number;
  shareFeedbackCount: number;
  hasPrepReference: boolean;
  latestVerifiedListeners: number | null;
  snapshotStreakWeeks: number;
  showsConfirmed: { isPaid: boolean; isHeadline: boolean; preDated: boolean }[];
  contactsCount: number;
  hasCollabRelease: boolean;
  releasesIn12mo: number;
  roadmapRead: Record<string, boolean>;  // profiles.roadmap_progress JSONB (playbook reads)
  activeProjects: { id: string; title: string; projectType: string; targetReleaseDate: string | null; rolloutScore: number }[];
  shareLinks: { playCount: number }[];
  lastReleaseAt: string | null;
}

export async function buildContext(db: Client, userId: string): Promise<CareerContext> {
  const { data: prof } = await db.from('profiles')
    .select('email,display_name,bio,profile_picture_url,roadmap_progress')
    .eq('user_id', userId).maybeSingle();
  const email = ((prof as any)?.email ?? '').toLowerCase() || null;

  // Projects first — collaborator lookup is scoped to the user's project ids.
  // (Awaited ONCE: supabase builders are thenables that re-execute per await.)
  const projects = await db.from('artist_projects')
    .select('id,project_type,current_phase,status,released_at,slug,target_release_date,rollout_score,title,featured_artists,created_at')
    .eq('user_id', userId);
  const projectIds = ((projects.data ?? []) as any[]).map((p) => p.id);

  const [links, bookings, collabs, feedback, prep, snaps, shows, contacts, shares] = await Promise.all([
    db.from('platform_connections').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    email
      ? db.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'completed').eq('customer_email', email)
      : Promise.resolve({ count: 0 } as any),
    projectIds.length
      ? db.from('project_collaborators').select('project_id').in('project_id', projectIds)
      : Promise.resolve({ data: [] } as any),
    // Feedback toward the gate EXCLUDES the artist's own email (anti-farm).
    db.from('track_share_feedback').select('id,listener_email,share_link_id,track_share_links!inner(user_id)')
      .eq('track_share_links.user_id', userId),
    db.from('session_prep').select('id,reference_tracks,beat_file_url').eq('user_id', userId),
    db.from('artist_metrics')
      .select('id,metric_date,monthly_listeners,metadata,platform,source')
      .eq('user_id', userId).eq('source', 'agent')
      .order('metric_date', { ascending: false }).limit(30),
    db.from('shows').select('show_date,is_paid,is_headline,confirmed_at,calendar_event_id,created_at').eq('user_id', userId),
    db.from('artist_contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    db.from('track_share_links').select('play_count').eq('user_id', userId),
  ]);

  const projRows = ((projects.data ?? []) as any[]);
  const released = projRows
    .filter((p) => p.current_phase === 'released' || p.released_at != null)
    .map((p) => ({ id: p.id, projectType: p.project_type, releasedAt: p.released_at ?? null, slug: p.slug ?? null }));

  // Singles-before-album: count released singles; check whether an album/EP
  // released before the 3rd single existed.
  const releasedFull = projRows
    .filter((p) => p.current_phase === 'released' || p.released_at != null)
    .sort((a, b) => String(a.released_at ?? a.created_at).localeCompare(String(b.released_at ?? b.created_at)));
  let singleCount = 0; let albumBefore = false;
  for (const p of releasedFull) {
    if (p.project_type === 'single') singleCount++;
    else if (['album', 'ep', 'mixtape', 'deluxe'].includes(p.project_type) && singleCount < 3) albumBefore = true;
  }

  // Collab release: an explicit project_collaborators row OR a featured artist
  // listed on a released project (artist_projects.featured_artists), so the
  // gate is reachable without a separate collaborator UI.
  const collabProjectIds = new Set(((collabs.data ?? []) as any[]).map((c) => c.project_id));
  const hasCollabRelease = releasedFull.some((p) =>
    collabProjectIds.has(p.id) || (Array.isArray(p.featured_artists) && p.featured_artists.length > 0));

  // Verified spotify snapshots (agent rows): latest non-anomalous listeners +
  // weekly streak across any-platform agent dates.
  const snapRows = ((snaps.data ?? []) as any[]);
  const spotifySnaps = snapRows.filter((s) => s.platform === 'spotify' && s.monthly_listeners != null);
  const latestClean = spotifySnaps.find((s) => !(s.metadata?.anomaly === true || s.metadata?.anomaly === 'true'));
  const dates = Array.from(new Set(snapRows.map((s) => String(s.metric_date)))).sort().reverse();
  let streak = dates.length > 0 ? 1 : 0;
  for (let i = 0; i + 1 < dates.length; i++) {
    const gap = daysBetweenIso(dates[i + 1], dates[i]);
    if (gap >= 1 && gap <= CONSECUTIVE_MAX_DAYS) streak++;
    else break;
  }

  const showRows = ((shows.data ?? []) as any[]).filter((s) => s.confirmed_at != null);

  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const releasesIn12mo = released.filter((p) => p.releasedAt != null && p.releasedAt >= yearAgo).length;
  const lastReleaseAt = releasedFull.length
    ? String(releasedFull[releasedFull.length - 1].released_at ?? '') || null : null;

  return {
    userId, email,
    platformLinkCount: links.count ?? 0,
    completedSessions: (bookings as any).count ?? 0,
    brandComplete: !!((prof as any)?.profile_picture_url && (prof as any)?.bio),
    releasedProjects: released,
    releasedSingles: singleCount,
    albumReleasedBeforeSingles: albumBefore,
    maxRolloutScore: Math.max(0, ...projRows.map((p) => Number(p.rollout_score) || 0)),
    // Distinct NON-owner listener emails only (self-feedback can't farm s2_share).
    shareFeedbackCount: new Set(((feedback.data ?? []) as any[])
      .map((f) => String(f.listener_email || '').toLowerCase())
      .filter((e) => e && e !== email)).size,
    hasPrepReference: ((prep.data ?? []) as any[]).some((r) =>
      (Array.isArray(r.reference_tracks) && r.reference_tracks.length > 0) || !!r.beat_file_url),
    latestVerifiedListeners: latestClean ? Number(latestClean.monthly_listeners) : null,
    snapshotStreakWeeks: streak,
    showsConfirmed: showRows.map((s) => ({
      isPaid: !!s.is_paid, isHeadline: !!s.is_headline,
      preDated: !!s.calendar_event_id && String(s.created_at).slice(0, 10) <= String(s.show_date),
    })),
    contactsCount: contacts.count ?? 0,
    hasCollabRelease,
    releasesIn12mo,
    roadmapRead: ((prof as any)?.roadmap_progress as Record<string, boolean>) ?? {},
    activeProjects: projRows.filter((p) => p.status === 'active').map((p) => ({
      id: p.id, title: p.title, projectType: p.project_type,
      targetReleaseDate: p.target_release_date ?? null, rolloutScore: Number(p.rollout_score) || 0,
    })),
    shareLinks: ((shares.data ?? []) as any[]).map((s) => ({ playCount: Number(s.play_count) || 0 })),
    lastReleaseAt,
  };
}

// ── Auto/semi checks (rule.check → predicate over the context) ──────────────

type CheckFn = (ctx: CareerContext, rule: Record<string, any>) => boolean;

export const CHECKS: Record<string, CheckFn> = {
  platform_links:        (ctx, r) => ctx.platformLinkCount >= (r.min ?? 1),
  completed_sessions:    (ctx, r) => ctx.completedSessions >= (r.min ?? 1),
  profile_brand:         (ctx) => ctx.brandComplete,
  released_projects:     (ctx, r) => ctx.releasedProjects.length >= (r.min ?? 1),
  singles_before_album:  (ctx, r) => ctx.releasedSingles >= (r.min ?? 3) && !ctx.albumReleasedBeforeSingles,
  share_feedback:        (ctx, r) => ctx.shareFeedbackCount >= (r.min ?? 3),
  rollout_at_least:      (ctx, r) => ctx.maxRolloutScore >= (r.score ?? 60),
  session_prep_reference:(ctx) => ctx.hasPrepReference,
  monthly_listeners:     (ctx, r) => (ctx.latestVerifiedListeners ?? 0) >= (r.min ?? 500),
  snapshot_streak_weeks: (ctx, r) => ctx.snapshotStreakWeeks >= (r.weeks ?? 4),
  shows_performed:       (ctx, r) => {
    const valid = ctx.showsConfirmed.filter((s) => s.preDated);
    if (valid.length < (r.min ?? 1)) return false;
    if (r.paidMin && valid.filter((s) => s.isPaid).length < r.paidMin) return false;
    return true;
  },
  headline_show:         (ctx) => ctx.showsConfirmed.some((s) => s.isHeadline && s.preDated),
  contacts_logged:       (ctx, r) => ctx.contactsCount >= (r.min ?? 3),
  collab_release:        (ctx) => ctx.hasCollabRelease,
  releases_in_12mo:      (ctx, r) => ctx.releasesIn12mo >= (r.min ?? 6),
};

// ── Gate evaluation: compute + persist requirement progress ─────────────────

export interface GateResult {
  newlyCompleted: string[];
  stage: number;
  previousStage: number;
  stageUp: boolean;
}

/**
 * Evaluate all machine-checkable requirements for one user and persist newly
 * met ones. Confirm-type requirements complete through their own routes —
 * EXCEPT those with a rule (e.g. contacts_logged), which auto-complete here.
 * Playbook requirements complete when every linked item is read.
 * Stage-up grants the stage achievement + an inbox congrats.
 */
export async function evaluateGates(db: Client, userId: string): Promise<GateResult> {
  const [{ data: catalog }, { data: progress }] = await Promise.all([
    db.from('career_stage_requirements').select('*').eq('active', true),
    db.from('requirement_progress').select('requirement_key,status').eq('user_id', userId),
  ]);
  const reqs = (catalog ?? []) as any[];
  const done = new Set(((progress ?? []) as any[])
    .filter((p) => p.status === 'complete').map((p) => p.requirement_key));

  const ctx = await buildContext(db, userId);
  const previousStage = computeStage(done, reqs.map((r) => ({ stage: r.stage, key: r.key })));

  const newlyCompleted: string[] = [];
  for (const req of reqs) {
    if (done.has(req.key)) continue;
    let met = false;
    let evidence: Record<string, unknown> | undefined;

    if (req.verify_type === 'playbook' && req.rule?.playbook) {
      const pb = req.rule.playbook as { section: string; items: number[] };
      met = pb.items.every((i) => ctx.roadmapRead[`${pb.section}-${i}`] === true);
      if (met) evidence = { items: pb.items.map((i) => `${pb.section}-${i}`) };
    } else if (req.rule?.check && CHECKS[req.rule.check]) {
      met = CHECKS[req.rule.check](ctx, req.rule);
      if (met) evidence = { check: req.rule.check, snapshot: snapshotEvidence(req.rule.check, ctx) };
    }
    if (!met) continue;

    const { error } = await db.from('requirement_progress').upsert({
      user_id: userId, requirement_key: req.key, status: 'complete',
      completed_at: new Date().toISOString(), evidence: evidence ?? {},
    } as never, { onConflict: 'user_id,requirement_key' });
    if (error) { console.error(`[career] progress write failed (${req.key}):`, error.message); continue; }

    done.add(req.key);
    newlyCompleted.push(req.key);
    await awardXP(db, userId, 'career_requirement', {
      referenceId: `req_${req.key}`, xpOverride: req.xp_award,
      metadata: { requirement: req.key, verify_type: req.verify_type },
    });
  }

  // Consistency achievements that mirror auto-gates (one write path).
  if (ctx.hasCollabRelease) await grantAchievement(db, userId, CAREER_ACHIEVEMENTS.consistency.collab);
  if (ctx.releasesIn12mo >= 6) await grantAchievement(db, userId, CAREER_ACHIEVEMENTS.consistency.sixReleases);
  if (ctx.snapshotStreakWeeks >= 4) await grantAchievement(db, userId, CAREER_ACHIEVEMENTS.consistency.streak4);

  // Stage-up fires off the DURABLE baseline (profiles.career_stage_computed),
  // so a catalog edit or a confirm-route completion can't skip the celebration
  // and a recompute drop never re-fires it. Persist the new stage.
  const stage = computeStage(done, reqs.map((r) => ({ stage: r.stage, key: r.key })));
  const { data: prevRow } = await db.from('profiles')
    .select('career_stage_computed').eq('user_id', userId).maybeSingle();
  const baseline = Number((prevRow as any)?.career_stage_computed ?? previousStage);
  const stageUp = stage > baseline;
  if (stage !== baseline) {
    await db.from('profiles').update({ career_stage_computed: stage } as never).eq('user_id', userId);
  }
  if (stageUp) await onStageUp(db, userId, stage);
  return { newlyCompleted, stage, previousStage: baseline, stageUp };
}

function snapshotEvidence(check: string, ctx: CareerContext): Record<string, unknown> {
  switch (check) {
    case 'monthly_listeners': return { listeners: ctx.latestVerifiedListeners };
    case 'platform_links': return { count: ctx.platformLinkCount };
    case 'completed_sessions': return { count: ctx.completedSessions };
    case 'snapshot_streak_weeks': return { weeks: ctx.snapshotStreakWeeks };
    case 'rollout_at_least': return { best: ctx.maxRolloutScore };
    default: return {};
  }
}

async function onStageUp(db: Client, userId: string, stage: number): Promise<void> {
  const key = CAREER_ACHIEVEMENTS.stages[stage];
  if (key) await grantAchievement(db, userId, key);
  try {
    const { mirrorToThread } = await import('@/lib/messaging-mirror');
    await mirrorToThread({
      userId, kind: 'update', subject: `You reached ${stageDisplay(stage)}`,
      body: `Big one. Every gate in ${stageDisplay(stage)} is verified and complete. Your roadmap has unlocked the next set of moves — keep going.`,
    });
  } catch { /* inbox mirror is best-effort */ }
}

// ── Listener tiers (Plan 6 §3) ───────────────────────────────────────────────

/**
 * Sweep one user (after their weekly snapshot) or all snapshot-bearing users
 * (cron). Grant = two consecutive verified weekly snapshots ≥ threshold,
 * neither anomaly-flagged. Permanent — rungs are only ever added.
 */
export async function sweepListenerTiers(db: Client, onlyUserId?: string, opts?: { silent?: boolean }):
  Promise<{ granted: { userId: string; tier: number }[] }> {
  let userIds: string[];
  if (onlyUserId) userIds = [onlyUserId];
  else {
    // Distinct users, paginated (PostgREST caps at 1000 rows/page).
    const seen = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('artist_metrics').select('user_id')
        .eq('source', 'agent').eq('platform', 'spotify').not('monthly_listeners', 'is', null)
        .range(from, from + 999);
      const rows = (data ?? []) as any[];
      rows.forEach((r) => seen.add(r.user_id));
      if (rows.length < 1000) break;
    }
    userIds = Array.from(seen);
  }

  const granted: { userId: string; tier: number }[] = [];
  for (const uid of userIds) {
    const { data: rows } = await db.from('artist_metrics')
      .select('id,metric_date,monthly_listeners,metadata')
      .eq('user_id', uid).eq('source', 'agent').eq('platform', 'spotify')
      .not('monthly_listeners', 'is', null)
      .order('metric_date', { ascending: false }).limit(2);
    const [latest, prev] = ((rows ?? []) as any[]).map((r): TierSnapshot => ({
      id: r.id, metricDate: String(r.metric_date),
      monthlyListeners: Number(r.monthly_listeners) || 0,
      anomaly: r.metadata?.anomaly === true || r.metadata?.anomaly === 'true',
    }));
    const top = tierFromSnapshots(latest ?? null, prev ?? null);
    if (!top) continue;

    const { data: have } = await db.from('listener_tiers').select('tier').eq('user_id', uid);
    const haveSet = new Set(((have ?? []) as any[]).map((t) => Number(t.tier)));
    let highestNew = 0;
    for (const t of TIER_LADDER) {
      if (t > top || haveSet.has(t)) continue;
      const { error } = await db.from('listener_tiers').insert({
        user_id: uid, tier: t, first_snapshot_id: prev!.id, second_snapshot_id: latest!.id,
      } as never);
      if (error) { console.error(`[tiers] insert failed (${uid} ${t}):`, error.message); continue; }
      granted.push({ userId: uid, tier: t });
      // Achievement per rung (cheap, idempotent, no fan-out).
      const aKey = CAREER_ACHIEVEMENTS.tiers[t];
      if (aKey) await grantAchievement(db, uid, aKey);
      if (t > highestNew) highestNew = t;
    }
    // ONE notification per user per sweep, for the HIGHEST new rung — a debut
    // at 500K announces "joined the 500K Club" once, not five times. Skipped
    // entirely in silent (baseline backfill) mode.
    if (highestNew > 0 && !opts?.silent) await onTierUp(db, uid, highestNew);
  }
  return { granted };
}

async function onTierUp(db: Client, userId: string, tier: number): Promise<void> {
  // Achievements are granted per-rung by the caller; this is notification-only.
  const { data: prof } = await db.from('profiles')
    .select('display_name,email').eq('user_id', userId).maybeSingle();
  const name = (prof as any)?.display_name || 'An artist';

  try {
    const { mirrorToThread } = await import('@/lib/messaging-mirror');
    // Personal congrats.
    await mirrorToThread({
      userId, kind: 'update', subject: `Welcome to the ${tierLabel(tier)}`,
      body: `Two consecutive verified weeks at ${tier.toLocaleString()}+ monthly listeners. This badge is permanent — it can never be taken away. It's on your profile now.`,
    });
    // Network broadcast → every artist's studio thread, system-voiced.
    const { createServiceClient } = await import('@/lib/supabase/server');
    const svc = createServiceClient();
    const { data: artists } = await svc.from('profiles').select('user_id,email')
      .not('user_id', 'is', null).neq('user_id', userId);
    const { TEST_EMAILS } = await import('@/lib/rewards-server');
    for (const a of ((artists ?? []) as any[])) {
      if (!a.user_id || (a.email && TEST_EMAILS.has(String(a.email).toLowerCase()))) continue;
      await mirrorToThread({
        userId: a.user_id, kind: 'update', subject: `${name} just joined the ${tierLabel(tier)}`,
        body: `${tier.toLocaleString()}+ verified monthly listeners, two weeks straight. The bar keeps moving — who's next?`,
      });
    }
    // 100K+ → plaque prompt to the studio owners (in-person award, photo op).
    if (tier >= PLAQUE_TIER_MIN) {
      const { SUPER_ADMINS } = await import('@/lib/constants');
      for (const adminEmail of SUPER_ADMINS) {
        await mirrorToThread({
          userEmail: adminEmail, kind: 'update',
          subject: `Plaque time: ${name} hit the ${tierLabel(tier)}`,
          body: `${name} just certified ${tier.toLocaleString()}+ verified monthly listeners (two consecutive weeks). Checklist: order the plaque, award it in person, get the photo, post it.`,
        });
      }
    }
  } catch (e) { console.error('[tiers] notify failed:', e); }
}

// ── Rollout score (Plan 6 §4) — recomputed on relevant writes ────────────────

import { computeRolloutScore, type RolloutInputs } from '@/lib/career';

/**
 * Recompute + persist a project's rollout score. The date_ahead item is
 * FROZEN at the moment the release date was set (stored in rollout_breakdown
 * .date_ahead_days by the projects route) — moving the date later never
 * retro-earns the points. Grants rollout achievements on threshold crossings.
 */
export async function recomputeProjectRollout(db: Client, projectId: string):
  Promise<{ score: number; breakdown: Record<string, boolean> } | null> {
  const { data: p } = await db.from('artist_projects').select('*').eq('id', projectId).maybeSingle();
  if (!p) return null;
  const proj = p as any;
  const target: string | null = proj.target_release_date ?? null;

  const winLo = target ? addDays(target, -45) : null; // photoshoot window when unlinked
  const [mediaLinked, mediaWindow, events, shareIds] = await Promise.all([
    db.from('media_bookings').select('id', { count: 'exact', head: true })
      .eq('linked_project_id', projectId).neq('status', 'cancelled'),
    // Fallback the RolloutInputs comment promised: a recent media booking by
    // the artist counts as the photoshoot even without an explicit link.
    winLo
      ? db.from('media_bookings').select('id', { count: 'exact', head: true })
          .eq('user_id', proj.user_id).neq('status', 'cancelled')
          .gte('created_at', winLo)
      : Promise.resolve({ count: 0 } as any),
    target
      ? db.from('calendar_events').select('event_date,event_type').eq('user_id', proj.user_id)
          .gte('event_date', addDays(target, -14)).lte('event_date', addDays(target, 7))
      : Promise.resolve({ data: [] } as any),
    db.from('track_share_links').select('id').eq('project_id', projectId),
  ]);

  const eventRows = ((events.data ?? []) as any[]).filter((e) => e.event_type !== 'studio_session');
  const preCount = target ? eventRows.filter((e) => e.event_date >= addDays(target, -14) && e.event_date < target).length : 0;
  const postCount = target ? eventRows.filter((e) => e.event_date >= target && e.event_date <= addDays(target, 7)).length : 0;
  // DISTINCT verified listeners (track_share_plays), not the farmable counter.
  const linkIds = ((shareIds.data ?? []) as any[]).map((l) => l.id);
  let plays = 0;
  if (linkIds.length) {
    const { count } = await db.from('track_share_plays')
      .select('id', { count: 'exact', head: true }).in('share_link_id', linkIds);
    plays = count ?? 0;
  }
  const dateAheadDays: number | null = (proj.rollout_breakdown as any)?.date_ahead_days ?? null;

  const inputs: RolloutInputs = {
    releaseDateSetDaysAhead: dateAheadDays,
    hasCoverArt: !!proj.cover_image_url,
    photoshootBooked: (mediaLinked.count ?? 0) > 0 || (mediaWindow.count ?? 0) > 0,
    videoBookedOrLinked: !!proj.video_url,
    hasPresave: !!proj.presave_url,
    preReleaseContentCount: preCount,
    shareLinkPlays: plays,
    hasAdBudget: proj.ad_budget_cents != null,
    postReleaseContentCount: postCount,
  };
  const { score, breakdown } = computeRolloutScore(inputs);

  await db.from('artist_projects').update({
    rollout_score: score,
    rollout_breakdown: { ...breakdown, date_ahead_days: dateAheadDays },
  } as never).eq('id', projectId);

  // Rollout achievements — any project, threshold crossings, idempotent.
  if (score >= 60) await grantAchievement(db, proj.user_id, CAREER_ACHIEVEMENTS.rollout.r60);
  if (score >= 85) await grantAchievement(db, proj.user_id, CAREER_ACHIEVEMENTS.rollout.r85);
  if (score >= 100) await grantAchievement(db, proj.user_id, CAREER_ACHIEVEMENTS.rollout.r100);

  return { score, breakdown };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Next-step engine (Plan 6 §6) — same state, advice voice ─────────────────
// Priority-ordered; the overview shows the top 3. Advice NEVER blocks anything.

export interface NextStep {
  id: string;
  priority: number;      // lower = more urgent
  message: string;
  href: string;          // deep link (hub tab or page)
  dismissible: boolean;
}

export function nextSteps(ctx: CareerContext, opts?: { stage?: number }): NextStep[] {
  const steps: NextStep[] = [];
  const add = (id: string, priority: number, message: string, href: string, dismissible = true) =>
    steps.push({ id, priority, message, href, dismissible });
  const today = new Date().toISOString().slice(0, 10);

  // Release-imminent urgency (the campaign window is NOW).
  for (const p of ctx.activeProjects) {
    if (!p.targetReleaseDate) continue;
    const days = daysBetweenIso(today, p.targetReleaseDate);
    if (days < 0 || days > 30) continue;
    if (p.rolloutScore < 40 && days <= 21) {
      add(`rollout_low_${p.id}`, 1, `"${p.title}" drops in ${days} days with a ${p.rolloutScore} rollout score. Open the checklist — book the shoot, add the pre-save.`, '?tab=projects', false);
    } else if (p.rolloutScore < 70 && days <= 14) {
      add(`rollout_mid_${p.id}`, 2, `${days} days out: "${p.title}" is at ${p.rolloutScore}/100. The last points are the cheap ones — content calendar + private link plays.`, '?tab=projects');
    }
    if (days <= 14 && ctx.shareLinks.length > 0 && ctx.shareLinks.every((l) => l.playCount === 0)) {
      add('share_unused', 2, `Your private listening link has 0 plays and the release is ${days} days out. Send it to 5 people today.`, '?tab=roadmap');
    }
  }

  // Foundation gaps (cheap, unlock everything else).
  if (ctx.platformLinkCount < 4) add('links', 3, `Connect ${4 - ctx.platformLinkCount} more platform link${4 - ctx.platformLinkCount === 1 ? '' : 's'} so your growth gets tracked weekly.`, '?tab=metrics');
  if (!ctx.brandComplete) add('brand', 3, 'Finish your brand basics — profile photo + bio. Two minutes, permanent first impression.', '/dashboard/profile');

  // Catalog momentum.
  if (ctx.activeProjects.length === 0 && ctx.releasedProjects.length === 0) {
    add('first_project', 4, 'Start your first project — even a one-track single. Everything in your roadmap hangs off it.', '?tab=projects', false);
  }
  if (ctx.lastReleaseAt) {
    const weeksSince = Math.floor(daysBetweenIso(ctx.lastReleaseAt.slice(0, 10), today) / 7);
    if (weeksSince >= 7 && ctx.activeProjects.length === 0) {
      add('next_single', 4, `${weeksSince} weeks since your last release. Momentum compounds — start the next single.`, '?tab=projects');
    }
  }
  // Singles-first nudge (advice, never a gate).
  if (ctx.releasedProjects.length < 6 && ctx.activeProjects.some((p) => ['album', 'ep'].includes(p.projectType))) {
    add('singles_first', 5, 'Singles build followings — albums reward them. Consider 3-4 singles before the big drop.', '?tab=projects');
  }

  // Audience habits.
  if (ctx.platformLinkCount >= 4 && ctx.snapshotStreakWeeks === 0) {
    add('tracking', 5, 'Your links are connected but no stats have landed yet — your first weekly check-in is coming. Watch the Metrics tab.', '?tab=metrics');
  }
  if (ctx.shareFeedbackCount === 0 && ctx.releasedProjects.length === 0 && ctx.activeProjects.length > 0) {
    add('first_share', 5, 'Before you release: share a private listening link and collect honest feedback while changes are still free.', '?tab=roadmap');
  }
  if (ctx.contactsCount < 3) add('network', 6, 'Log the creatives you already know — 3 contacts starts your network list.', '?tab=roadmap');
  if (ctx.completedSessions === 0) add('book', 6, 'Book your first session — your roadmap starts in the studio.', '/book', false);

  return steps.sort((a, b) => a.priority - b.priority);
}

// ── Career summary (the UI read model) ───────────────────────────────────────

export async function getCareerSummary(db: Client, userId: string) {
  const [{ data: catalog }, { data: progress }, { data: tiers }] = await Promise.all([
    db.from('career_stage_requirements').select('*').eq('active', true).order('stage').order('sort'),
    db.from('requirement_progress').select('*').eq('user_id', userId),
    db.from('listener_tiers').select('tier,achieved_at').eq('user_id', userId).order('tier'),
  ]);
  const reqs = (catalog ?? []) as any[];
  const progMap = new Map(((progress ?? []) as any[]).map((p) => [p.requirement_key, p]));
  const done = new Set(((progress ?? []) as any[])
    .filter((p) => p.status === 'complete').map((p) => p.requirement_key));
  const stage = computeStage(done, reqs.map((r) => ({ stage: r.stage, key: r.key })));
  const tierRows = (tiers ?? []) as any[];
  return {
    stage, stageLabel: stageDisplay(stage),
    highestTier: tierRows.length ? Number(tierRows[tierRows.length - 1].tier) : null,
    tiers: tierRows.map((t) => ({ tier: Number(t.tier), label: tierLabel(Number(t.tier)), achievedAt: t.achieved_at })),
    requirements: reqs.map((r) => ({
      key: r.key, stage: r.stage, title: r.title, description: r.description,
      verifyType: r.verify_type, confirmFields: r.confirm_fields, xp: r.xp_award,
      rule: r.rule,
      status: done.has(r.key) ? 'complete' : 'pending',
      completedAt: progMap.get(r.key)?.completed_at ?? null,
      evidence: progMap.get(r.key)?.evidence ?? null,
    })),
  };
}
