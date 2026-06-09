// lib/agent-stats.ts — pure logic for the Agent Stats Console (no DB, no Next).
//
// The console is Cowork's weekly verification layer: a human agent walks a queue
// of ACTIVE artists, opens each pasted platform link, and records the public
// numbers into artist_metrics with source='agent'. Only agent / spotify_api /
// youtube_api rows are chart-eligible (see chart_eligible_metrics view, 075).
//
// Tested by scripts/agent-console-test.ts.

import { TIMEZONE } from '@/lib/constants';

// ── platform field map ───────────────────────────────────────────────────────
// Columns are REAL artist_metrics columns (012 + 015) — the save path whitelists
// against this map so a tampered payload can't write arbitrary columns.
// apple_music is intentionally absent: Apple/Amazon numbers come from the artist
// screenshot-verification flow (source='screenshot_verified'), never the agent.

export type AgentMetricColumn =
  | 'followers' | 'monthly_listeners' | 'subscribers'
  | 'total_views' | 'plays' | 'total_likes';

export interface AgentPlatformField { column: AgentMetricColumn; label: string }
export interface AgentPlatform { key: string; label: string; fields: AgentPlatformField[] }

export const AGENT_PLATFORMS: AgentPlatform[] = [
  { key: 'spotify',    label: 'Spotify',    fields: [{ column: 'monthly_listeners', label: 'Monthly listeners' }, { column: 'followers', label: 'Followers' }] },
  { key: 'soundcloud', label: 'SoundCloud', fields: [{ column: 'followers', label: 'Followers' }, { column: 'plays', label: 'Total plays' }] },
  { key: 'youtube',    label: 'YouTube',    fields: [{ column: 'subscribers', label: 'Subscribers' }, { column: 'total_views', label: 'Total views' }] },
  { key: 'instagram',  label: 'Instagram',  fields: [{ column: 'followers', label: 'Followers' }] },
  { key: 'tiktok',     label: 'TikTok',     fields: [{ column: 'followers', label: 'Followers' }, { column: 'total_likes', label: 'Total likes' }] },
  { key: 'facebook',   label: 'Facebook',   fields: [{ column: 'followers', label: 'Followers' }] },
  { key: 'twitter',    label: 'X',          fields: [{ column: 'followers', label: 'Followers' }] },
  { key: 'audiomack',  label: 'Audiomack',  fields: [{ column: 'followers', label: 'Followers' }, { column: 'plays', label: 'Total plays' }] },
  { key: 'deezer',     label: 'Deezer',     fields: [{ column: 'followers', label: 'Fans' }] },
];

export const AGENT_PLATFORM_KEYS = AGENT_PLATFORMS.map((p) => p.key);
export const agentPlatform = (key: string): AgentPlatform | undefined =>
  AGENT_PLATFORMS.find((p) => p.key === key);

export const AGENT_STATUSES = ['recorded', 'blocked', 'page_not_found', 'skipped'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

// The only sources DreamSuite Charts may read (mirrors chart_eligible_metrics).
export const CHART_ELIGIBLE_SOURCES = ['agent', 'spotify_api', 'youtube_api'] as const;

// ── studio-local "today" ─────────────────────────────────────────────────────

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Studio-local date string (YYYY-MM-DD) + weekday index (Mon=0 … Sun=6). */
export function studioToday(now: Date = new Date()): { dateStr: string; dayIdx: number } {
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const weekday = now.toLocaleDateString('en-US', { timeZone: TIMEZONE, weekday: 'short' });
  return { dateStr, dayIdx: DAY_ORDER.indexOf(weekday) };
}

// ── weekday slicing ──────────────────────────────────────────────────────────

/** Stable weekday assignment: hash(user_id) % 5 → 0=Mon … 4=Fri. */
export function weekdaySlot(userId: string): number {
  const hex = userId.replace(/-/g, '').slice(0, 8);
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n % 5 : 0;
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface DueInput { userId: string; lastAgentDate: string | null }
export interface DueResult { include: boolean; dueToday: boolean; missed: boolean; done: boolean; slot: number }

/**
 * Queue membership for one artist. Weekdays: due if slot === today, plus
 * missed-earlier-this-week artists with no agent snapshot in the last 6 days
 * (a failed day self-heals tomorrow). Weekends are pure catch-up: anyone stale.
 * "done" = an agent snapshot exists today (still listed, counted complete).
 */
export function computeDue(input: DueInput, today: { dateStr: string; dayIdx: number }): DueResult {
  const slot = weekdaySlot(input.userId);
  const done = input.lastAgentDate === today.dateStr;
  const recent = input.lastAgentDate != null && daysBetween(input.lastAgentDate, today.dateStr) <= 6;

  if (today.dayIdx <= 4) {
    const dueToday = slot === today.dayIdx;
    // Missed = an earlier slot this week, OR a cross-week miss: a Friday-slot
    // artist whose Friday AND weekend catch-up were skipped would otherwise be
    // invisible Mon–Thu (slot 4 is never < dayIdx) and silently gap two weeks.
    // Never-recorded artists still wait for their first slot day.
    const crossWeekStale = input.lastAgentDate != null
      && daysBetween(input.lastAgentDate, today.dateStr) >= 7;
    const missed = !dueToday && !recent && (slot < today.dayIdx || crossWeekStale);
    return { include: dueToday || missed, dueToday, missed, done, slot };
  }
  // Weekend: nobody is "due", everything stale this week is catch-up.
  const missed = !recent;
  return { include: missed || done, dueToday: false, missed, done, slot };
}

// ── anomaly guard ────────────────────────────────────────────────────────────

export const ANOMALY_THRESHOLD = 0.5; // ±50% vs the last verified snapshot

/** True when next differs from a positive prior value by more than 50%. */
export function isAnomalous(prev: number | null | undefined, next: number | null | undefined): boolean {
  if (prev == null || next == null) return false;
  if (prev <= 0) return false; // no usable baseline
  return Math.abs(next - prev) / prev > ANOMALY_THRESHOLD;
}
