// lib/agent-stats-server.ts — DB layer for the Agent Stats Console.
//
// Client-injected (takes a db param, no next/headers) so it's importable from
// routes AND tsx scripts — same convention as lib/rewards-server.ts. All callers
// pass the SERVICE client: the routes gate on the agent/admin role first, and the
// artist_tracking_status view must be read with service-role (security_invoker —
// a user-scoped client would silently empty its laterals under RLS).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AGENT_PLATFORMS, AGENT_STATUSES, CHART_ELIGIBLE_SOURCES,
  agentPlatform, computeDue, daysBetween, isAnomalous, studioToday,
  type AgentMetricColumn, type AgentStatus,
} from '@/lib/agent-stats';
import { TEST_EMAILS } from '@/lib/rewards-server';
import { SITE_URL } from '@/lib/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

// ── tracking status ──────────────────────────────────────────────────────────

export interface TrackingStatus { isActive: boolean; lastPaidAt: string | null }

export async function getTrackingStatus(db: Client, userId: string): Promise<TrackingStatus> {
  const { data } = await db.from('artist_tracking_status')
    .select('is_active,last_paid_at').eq('user_id', userId).maybeSingle();
  return { isActive: !!(data as any)?.is_active, lastPaidAt: (data as any)?.last_paid_at ?? null };
}

async function trackingStatusMap(db: Client, userIds: string[]): Promise<Map<string, TrackingStatus>> {
  const map = new Map<string, TrackingStatus>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await db.from('artist_tracking_status')
      .select('user_id,is_active,last_paid_at').in('user_id', userIds.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) {
      map.set(r.user_id, { isActive: !!r.is_active, lastPaidAt: r.last_paid_at ?? null });
    }
  }
  return map;
}

// ── the work queue ───────────────────────────────────────────────────────────

export interface QueueArtist {
  userId: string;
  name: string;
  email: string;
  photoUrl: string | null;
  connectionCount: number;
  lastAgentDate: string | null;
  slot: number;
  dueToday: boolean;
  missed: boolean;
  done: boolean;
}

export interface AgentQueue {
  dateStr: string;
  dayIdx: number;
  artists: QueueArtist[];
  stats: { due: number; done: number; remaining: number };
}

/**
 * Artists due today (stable weekday slot) + missed-earlier-this-week catch-ups.
 * Eligibility: ACTIVE (paid in 90 days), ≥1 platform connection, not a test
 * account. Paused artists never appear — that's the money-saving rule.
 */
export async function buildAgentQueue(db: Client, now: Date = new Date()): Promise<AgentQueue> {
  const today = studioToday(now);

  const { data: conns } = await db.from('platform_connections').select('user_id,platform');
  const connCount = new Map<string, number>();
  for (const c of (conns ?? []) as any[]) connCount.set(c.user_id, (connCount.get(c.user_id) || 0) + 1);
  const userIds = Array.from(connCount.keys());
  if (userIds.length === 0) return { ...today, artists: [], stats: { due: 0, done: 0, remaining: 0 } };

  const [{ data: profs }, status] = await Promise.all([
    db.from('profiles').select('user_id,email,display_name,profile_picture_url').in('user_id', userIds),
    trackingStatusMap(db, userIds),
  ]);

  // FIRST + latest agent snapshot dates per artist. First = the anchor (the
  // weekday an artist was first tracked is their recheck day forever); latest
  // drives "done today" + staleness. Rows arrive date-desc, so the first row
  // seen per user is their latest and the last row seen is their first.
  const lastAgent = new Map<string, string>();
  const firstAgent = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data: rows } = await db.from('artist_metrics')
      .select('user_id,metric_date').eq('source', 'agent')
      .in('user_id', userIds.slice(i, i + 200))
      .order('metric_date', { ascending: false }).limit(2000);
    for (const r of (rows ?? []) as any[]) {
      if (!lastAgent.has(r.user_id)) lastAgent.set(r.user_id, r.metric_date);
      firstAgent.set(r.user_id, r.metric_date); // keeps overwriting → oldest wins
    }
  }

  const artists: QueueArtist[] = [];
  for (const p of (profs ?? []) as any[]) {
    const email = String(p.email || '').toLowerCase();
    if (!email || TEST_EMAILS.has(email)) continue;
    if (!status.get(p.user_id)?.isActive) continue; // PAUSED → never queued
    const due = computeDue({
      userId: p.user_id,
      firstAgentDate: firstAgent.get(p.user_id) ?? null,
      lastAgentDate: lastAgent.get(p.user_id) ?? null,
    }, today);
    if (!due.include) continue;
    artists.push({
      userId: p.user_id,
      name: p.display_name || p.email,
      email: p.email,
      photoUrl: p.profile_picture_url ?? null,
      connectionCount: connCount.get(p.user_id) || 0,
      lastAgentDate: lastAgent.get(p.user_id) ?? null,
      slot: due.slot, dueToday: due.dueToday, missed: due.missed, done: due.done,
    });
  }
  // Due-today first, then missed; undone before done; stable by name.
  artists.sort((a, b) =>
    Number(b.dueToday) - Number(a.dueToday) || Number(a.done) - Number(b.done) || a.name.localeCompare(b.name));

  const done = artists.filter((a) => a.done).length;
  return { ...today, artists, stats: { due: artists.length, done, remaining: artists.length - done } };
}

// ── per-artist work screen ───────────────────────────────────────────────────

export interface WorkPlatform {
  key: string;
  label: string;
  fields: { column: AgentMetricColumn; label: string }[];
  connection: { url: string | null; displayName: string | null; lastFetchedAt: string | null; fetchError: string | null } | null;
  lastAgent: { date: string; values: Partial<Record<AgentMetricColumn, number | null>>; anomaly: boolean } | null;
  prefill: { source: string; values: Partial<Record<AgentMetricColumn, number | null>> } | null;
}

export interface ArtistWork {
  userId: string;
  name: string;
  email: string;
  photoUrl: string | null;
  isActive: boolean;
  lastPaidAt: string | null;
  lastAgentDate: string | null;
  platforms: WorkPlatform[];
}

const pickValues = (row: any, cols: { column: AgentMetricColumn }[]) =>
  Object.fromEntries(cols.map((f) => [f.column, row?.[f.column] ?? null]));

export async function getArtistWork(db: Client, userId: string, now: Date = new Date()): Promise<ArtistWork | null> {
  const today = studioToday(now);
  const [{ data: prof }, statusRow, { data: conns }, { data: agentRows }, { data: prefillRows }] = await Promise.all([
    db.from('profiles').select('user_id,email,display_name,profile_picture_url').eq('user_id', userId).maybeSingle(),
    getTrackingStatus(db, userId),
    db.from('platform_connections').select('platform,platform_url,display_name,last_fetched_at,fetch_error').eq('user_id', userId),
    db.from('artist_metrics').select('*').eq('user_id', userId).eq('source', 'agent')
      .order('metric_date', { ascending: false }).limit(60),
    db.from('artist_metrics').select('*').eq('user_id', userId).eq('metric_date', today.dateStr)
      .in('source', ['spotify_api', 'youtube_api']),
  ]);
  if (!prof) return null;
  // Authz bound: the agent's read access stops at the tracking program. A user
  // with zero platform links is not the agent's business — returning null keeps
  // off-program profiles (admins, engineers, plain customers) unreadable even
  // though the route runs on the service client.
  if (((conns ?? []) as any[]).length === 0) return null;

  const connByPlatform = new Map<string, any>(((conns ?? []) as any[]).map((c) => [c.platform, c]));
  const lastAgentByPlatform = new Map<string, any>();
  for (const r of (agentRows ?? []) as any[]) {
    if (!lastAgentByPlatform.has(r.platform)) lastAgentByPlatform.set(r.platform, r);
  }
  const prefillByPlatform = new Map<string, any>(((prefillRows ?? []) as any[]).map((r) => [r.platform, r]));

  const platforms: WorkPlatform[] = AGENT_PLATFORMS.map((p) => {
    const conn = connByPlatform.get(p.key);
    const last = lastAgentByPlatform.get(p.key);
    const pre = prefillByPlatform.get(p.key);
    return {
      key: p.key, label: p.label, fields: p.fields,
      connection: conn ? {
        url: conn.platform_url ?? null, displayName: conn.display_name ?? null,
        lastFetchedAt: conn.last_fetched_at ?? null, fetchError: conn.fetch_error ?? null,
      } : null,
      lastAgent: last ? {
        date: last.metric_date,
        values: pickValues(last, p.fields),
        anomaly: !!(last.metadata as Record<string, unknown> | null)?.anomaly,
      } : null,
      prefill: pre ? { source: pre.source, values: pickValues(pre, p.fields) } : null,
    };
  });

  return {
    userId, name: (prof as any).display_name || (prof as any).email, email: (prof as any).email,
    photoUrl: (prof as any).profile_picture_url ?? null,
    isActive: statusRow.isActive, lastPaidAt: statusRow.lastPaidAt,
    lastAgentDate: ((agentRows ?? []) as any[])[0]?.metric_date ?? null,
    platforms,
  };
}

// ── save flow ────────────────────────────────────────────────────────────────

export interface AgentEntry {
  platform: string;
  status: AgentStatus;
  values?: Partial<Record<AgentMetricColumn, number | null>>;
}

export interface AnomalyDetail {
  platform: string; column: AgentMetricColumn; previous: number; next: number; pctChange: number;
}

export type SaveResult =
  | { needsConfirmation: true; anomalies: AnomalyDetail[] }
  | {
      needsConfirmation: false;
      saved: string[];
      stamped: string[];
      rejected: { platform: string; reason: string; lastDate: string }[];
      anomaliesFlagged: number;
    };

/**
 * Writes one artist_metrics row per recorded platform (source='agent'), stamps
 * platform_connections, and bumps the run counters. Rules:
 *  - duplicate rejection: an agent snapshot 1–6 days old blocks a new one
 *    (same-day re-save is a CORRECTION and upserts over today's row);
 *  - anomaly guard: >50% swing vs the last chart-eligible snapshot requires
 *    confirmAnomalies; confirmed rows save with metadata.anomaly=true and are
 *    held out of charts until reviewed;
 *  - field whitelist: only columns in the platform's AGENT_PLATFORMS map.
 */
export async function saveAgentMetrics(db: Client, args: {
  userId: string;
  recordedBy: string;
  entries: AgentEntry[];
  runId?: string | null;
  confirmAnomalies?: boolean;
  now?: Date;
}): Promise<SaveResult> {
  const now = args.now ?? new Date();
  const today = studioToday(now);
  const nowIso = now.toISOString();

  // Validate + normalize entries (drop unknown platforms/columns, coerce ints).
  const entries = args.entries
    .filter((e) => agentPlatform(e.platform) && (AGENT_STATUSES as readonly string[]).includes(e.status))
    .map((e) => {
      const def = agentPlatform(e.platform)!;
      const values: Partial<Record<AgentMetricColumn, number>> = {};
      if (e.status === 'recorded' && e.values) {
        for (const f of def.fields) {
          const raw = e.values[f.column];
          if (raw == null || raw === ('' as never)) continue;
          const n = Math.round(Number(raw));
          if (Number.isFinite(n) && n >= 0) values[f.column] = n;
        }
      }
      return { platform: e.platform, status: e.status, values };
    });

  const recorded = entries.filter((e) => e.status === 'recorded' && Object.keys(e.values).length > 0);

  // Duplicate rejection + anomaly baselines need the recent history per platform.
  const rejected: { platform: string; reason: string; lastDate: string }[] = [];
  const anomalies: AnomalyDetail[] = [];
  const writable: typeof recorded = [];

  for (const e of recorded) {
    const { data: lastAgentRow } = await db.from('artist_metrics')
      .select('metric_date').eq('user_id', args.userId).eq('platform', e.platform)
      .eq('source', 'agent').order('metric_date', { ascending: false }).limit(1).maybeSingle();
    const lastDate = (lastAgentRow as any)?.metric_date as string | undefined;
    if (lastDate && lastDate !== today.dateStr && daysBetween(lastDate, today.dateStr) <= 6) {
      rejected.push({ platform: e.platform, reason: 'duplicate_within_6_days', lastDate });
      continue;
    }

    // Anomaly baseline: last chart-eligible snapshot strictly before today.
    const { data: baseRow } = await db.from('artist_metrics')
      .select('*').eq('user_id', args.userId).eq('platform', e.platform)
      .in('source', CHART_ELIGIBLE_SOURCES as unknown as string[])
      .lt('metric_date', today.dateStr)
      .order('metric_date', { ascending: false }).limit(1).maybeSingle();
    for (const [col, next] of Object.entries(e.values) as [AgentMetricColumn, number][]) {
      const prev = (baseRow as any)?.[col];
      if (isAnomalous(prev, next)) {
        anomalies.push({
          platform: e.platform, column: col, previous: Number(prev), next,
          pctChange: Math.round((Math.abs(next - Number(prev)) / Number(prev)) * 100),
        });
      }
    }
    writable.push(e);
  }

  if (anomalies.length > 0 && !args.confirmAnomalies) {
    return { needsConfirmation: true, anomalies };
  }

  const anomalousPlatforms = new Set(anomalies.map((a) => a.platform));
  const saved: string[] = [];

  for (const e of writable) {
    // Merge over any existing row for today (API prefill or an earlier agent
    // save) so fields the agent didn't enter — e.g. popularity_score from the
    // Spotify API — survive. Agent values + source win.
    const { data: existing } = await db.from('artist_metrics')
      .select('*').eq('user_id', args.userId).eq('platform', e.platform)
      .eq('metric_date', today.dateStr).maybeSingle();

    const metadata: Record<string, unknown> = {
      ...((existing as any)?.metadata ?? {}),
      run_id: args.runId ?? null,
      recorded_at: nowIso,
    };
    if (anomalousPlatforms.has(e.platform)) metadata.anomaly = true;
    else delete metadata.anomaly; // a same-day correction can clear the flag

    const { error } = await db.from('artist_metrics').upsert({
      user_id: args.userId,
      metric_date: today.dateStr,
      platform: e.platform,
      ...e.values,
      source: 'agent',
      recorded_by: args.recordedBy,
      metadata,
    } as never, { onConflict: 'user_id,metric_date,platform' });
    if (!error) saved.push(e.platform);
  }

  // Stamp every touched connection: recorded clears fetch_error, the other
  // statuses store WHY ('blocked' | 'page_not_found' | 'skipped'). Rejected
  // duplicates and failed writes stamp NOTHING — nothing was actually recorded.
  const stamped: string[] = [];
  for (const e of entries) {
    if (e.status === 'recorded' && !saved.includes(e.platform)) continue;
    const { error } = await db.from('platform_connections').update({
      last_fetched_at: nowIso,
      fetch_error: e.status === 'recorded' ? null : e.status,
      updated_at: nowIso,
    } as never).eq('user_id', args.userId).eq('platform', e.platform);
    if (!error) stamped.push(e.platform);
  }

  // Run counters (single operator — read-modify-write is fine). artists_processed
  // is deduped per artist via metadata.processed_user_ids so a partial-platform
  // revisit or an anomaly confirm→retry doesn't inflate the end-of-day report.
  if (args.runId) {
    const { data: run } = await db.from('agent_runs').select('*').eq('id', args.runId).maybeSingle();
    if (run) {
      const md = ((run as any).metadata ?? {}) as Record<string, unknown>;
      const processed: string[] = Array.isArray(md.processed_user_ids) ? (md.processed_user_ids as string[]) : [];
      const firstVisit = !processed.includes(args.userId);
      await db.from('agent_runs').update({
        artists_processed: ((run as any).artists_processed || 0) + (firstVisit ? 1 : 0),
        platforms_recorded: ((run as any).platforms_recorded || 0) + saved.length,
        blocked_count: ((run as any).blocked_count || 0)
          + entries.filter((e) => e.status === 'blocked' || e.status === 'page_not_found').length,
        skipped_count: ((run as any).skipped_count || 0) + entries.filter((e) => e.status === 'skipped').length,
        anomaly_count: ((run as any).anomaly_count || 0) + anomalousPlatforms.size,
        metadata: { ...md, processed_user_ids: firstVisit ? [...processed, args.userId] : processed },
      } as never).eq('id', args.runId);
    }
  }

  return { needsConfirmation: false, saved, stamped, rejected, anomaliesFlagged: anomalousPlatforms.size };
}

/**
 * Clears the anomaly hold on a past agent snapshot (after review), restoring its
 * chart eligibility. Without this, a confirmed-legitimate spike (artist went
 * viral) would keep that snapshot dark forever — the duplicate window blocks a
 * same-platform re-save for 6 days, so same-day correction alone can't fix it.
 */
export async function clearAnomalyFlag(db: Client, args: {
  userId: string; platform: string; metricDate: string;
}): Promise<boolean> {
  const { data: row } = await db.from('artist_metrics')
    .select('id,metadata').eq('user_id', args.userId).eq('platform', args.platform)
    .eq('metric_date', args.metricDate).eq('source', 'agent').maybeSingle();
  if (!row) return false;
  const md = { ...(((row as any).metadata ?? {}) as Record<string, unknown>) };
  delete md.anomaly;
  md.anomaly_cleared_at = new Date().toISOString();
  const { error } = await db.from('artist_metrics').update({ metadata: md } as never).eq('id', (row as any).id);
  return !error;
}

// ── runs ─────────────────────────────────────────────────────────────────────

export async function startAgentRun(db: Client, agentUserId: string, now: Date = new Date()) {
  const today = studioToday(now);
  const { data: open } = await db.from('agent_runs')
    .select('*').eq('run_date', today.dateStr).is('finished_at', null)
    .order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (open) return open;
  const instance = new URL(SITE_URL).host;
  const { data, error } = await db.from('agent_runs')
    .insert({ run_date: today.dateStr, instance, agent_user_id: agentUserId } as never)
    .select('*').single();
  if (error) throw new Error(`agent_runs insert: ${error.message}`);
  return data;
}

export async function finishAgentRun(db: Client, runId: string) {
  const { data, error } = await db.from('agent_runs')
    .update({ finished_at: new Date().toISOString() } as never)
    .eq('id', runId).select('*').single();
  if (error) throw new Error(`agent_runs finish: ${error.message}`);
  return data;
}

// ── pause emails (win-back, once per pause episode) ──────────────────────────

/**
 * Finds artists whose tracking just paused (have connections, were once paying,
 * inactive now) and who haven't been notified for THIS pause episode, sends the
 * win-back email via the injected sender, and records the notice. Resume is
 * automatic (the view flips on the next payment) — no email needed for that.
 */
export async function sweepPauseNotices(
  db: Client,
  send: (to: string, details: { name: string }) => Promise<void>,
): Promise<{ candidates: number; notified: number }> {
  const { data: conns } = await db.from('platform_connections').select('user_id');
  const userIds = Array.from(new Set(((conns ?? []) as any[]).map((c) => c.user_id)));
  if (userIds.length === 0) return { candidates: 0, notified: 0 };

  const status = await trackingStatusMap(db, userIds);
  const pausedIds = userIds.filter((id) => {
    const s = status.get(id);
    return s && !s.isActive && s.lastPaidAt != null; // was a customer, lapsed
  });
  if (pausedIds.length === 0) return { candidates: 0, notified: 0 };

  const [{ data: profs }, noticesRes] = await Promise.all([
    db.from('profiles').select('user_id,email,display_name').in('user_id', pausedIds),
    db.from('agent_pause_notices').select('user_id,last_paid_at_at_notice').in('user_id', pausedIds),
  ]);
  // If the dedup read fails we CANNOT tell who was already notified — abort the
  // sweep rather than risk re-emailing every paused artist.
  if (noticesRes.error) {
    console.error('[agent-stats] pause-notice dedup read failed — sweep aborted:', noticesRes.error.message);
    return { candidates: pausedIds.length, notified: 0 };
  }
  const noticeByUser = new Map<string, any>(((noticesRes.data ?? []) as any[]).map((n) => [n.user_id, n]));

  let notified = 0;
  for (const p of (profs ?? []) as any[]) {
    const email = String(p.email || '').toLowerCase();
    if (!email || TEST_EMAILS.has(email)) continue;
    const s = status.get(p.user_id)!;
    const prior = noticeByUser.get(p.user_id);
    // Already notified for this pause episode (no payment since the notice)?
    if (prior && (!s.lastPaidAt || !prior.last_paid_at_at_notice
        || new Date(prior.last_paid_at_at_notice) >= new Date(s.lastPaidAt))) continue;
    // Record the notice BEFORE sending: a recorded-but-unsent notice costs one
    // win-back email; a sent-but-unrecorded notice re-spams the artist daily
    // until the write succeeds. (send() logs its own failures, never throws.)
    const { error: noticeErr } = await db.from('agent_pause_notices').upsert({
      user_id: p.user_id,
      notified_at: new Date().toISOString(),
      last_paid_at_at_notice: s.lastPaidAt,
    } as never, { onConflict: 'user_id' });
    if (noticeErr) {
      console.error('[agent-stats] pause notice write failed for', p.user_id, noticeErr.message);
      continue;
    }
    await send(p.email, { name: p.display_name || 'there' });
    notified++;
  }
  return { candidates: pausedIds.length, notified };
}
