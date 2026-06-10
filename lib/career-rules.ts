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

  const [links, bookings, projects, collabs, feedback, prep, snaps, shows, contacts, shares] = await Promise.all([
    db.from('platform_connections').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    email
      ? db.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'completed').ilike('customer_email', email)
      : Promise.resolve({ count: 0 } as any),
    db.from('artist_projects')
      .select('id,project_type,current_phase,status,released_at,slug,target_release_date,rollout_score,title,created_at')
      .eq('user_id', userId),
    db.from('project_collaborators').select('project_id'),
    db.from('track_share_feedback').select('id,share_link_id,track_share_links!inner(user_id)')
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

  const collabProjectIds = new Set(((collabs.data ?? []) as any[]).map((c) => c.project_id));
  const hasCollabRelease = released.some((p) => collabProjectIds.has(p.id));

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
    shareFeedbackCount: (feedback.data ?? []).length,
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

  const stage = computeStage(done, reqs.map((r) => ({ stage: r.stage, key: r.key })));
  const stageUp = stage > previousStage;
  if (stageUp) await onStageUp(db, userId, stage);
  return { newlyCompleted, stage, previousStage, stageUp };
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
export async function sweepListenerTiers(db: Client, onlyUserId?: string):
  Promise<{ granted: { userId: string; tier: number }[] }> {
  let userIds: string[];
  if (onlyUserId) userIds = [onlyUserId];
  else {
    const { data } = await db.from('artist_metrics').select('user_id')
      .eq('source', 'agent').eq('platform', 'spotify').not('monthly_listeners', 'is', null);
    userIds = Array.from(new Set(((data ?? []) as any[]).map((r) => r.user_id)));
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
    for (const t of TIER_LADDER) {
      if (t > top || haveSet.has(t)) continue;
      const { error } = await db.from('listener_tiers').insert({
        user_id: uid, tier: t, first_snapshot_id: prev!.id, second_snapshot_id: latest!.id,
      } as never);
      if (error) { console.error(`[tiers] insert failed (${uid} ${t}):`, error.message); continue; }
      granted.push({ userId: uid, tier: t });
      await onTierUp(db, uid, t);
    }
  }
  return { granted };
}

async function onTierUp(db: Client, userId: string, tier: number): Promise<void> {
  const key = CAREER_ACHIEVEMENTS.tiers[tier];
  if (key) await grantAchievement(db, userId, key);

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
