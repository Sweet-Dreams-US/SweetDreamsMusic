// lib/social-links-server.ts — unified social links on platform_connections.
//
// One source of truth for an artist's social links: the `platform_connections`
// table (migration 015). That table is what the metrics-tracking pipeline reads,
// so by storing profile social links there too we get a single list that both
// the profile-completion check AND the weekly agent run see.
//
// Client-injected (every export takes a Supabase `db` arg, no next/headers) so
// it's importable from API routes, server components, and tsx scripts. Pass the
// appropriate client at the call site (user-scoped for user actions; service for
// cron/admin) — same convention as lib/agent-stats-server.ts.
//
// Platform key namespace == what platform_connections + the connections route +
// METRIC_PLATFORMS already use:
//   spotify | apple_music | instagram | tiktok | youtube | soundcloud
//   | twitter | facebook
// The legacy profiles.social_links JSONB uses camelCase `appleMusic`; the only
// rename on backfill is appleMusic -> apple_music.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractSpotifyArtistId,
  extractYouTubeChannelInfo,
} from '@/lib/platform-fetch';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/**
 * The canonical platform keys for unified social links — identical to the keys
 * platform_connections / the connections route / METRIC_PLATFORMS use.
 */
export const SOCIAL_PLATFORM_KEYS = [
  'spotify',
  'apple_music',
  'instagram',
  'tiktok',
  'youtube',
  'soundcloud',
  'twitter',
  'facebook',
] as const;

export type SocialPlatformKey = (typeof SOCIAL_PLATFORM_KEYS)[number];

/**
 * Maps a legacy profiles.social_links JSONB key to the canonical
 * platform_connections platform key. Keys absent here pass through unchanged
 * (they already match), so only the camelCase outlier needs an entry.
 */
const LEGACY_KEY_MAP: Record<string, SocialPlatformKey> = {
  spotify: 'spotify',
  appleMusic: 'apple_music',
  apple_music: 'apple_music',
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube',
  soundcloud: 'soundcloud',
  twitter: 'twitter',
  facebook: 'facebook',
};

/** Result of {@link getUnifiedSocialLinks}. */
export interface UnifiedSocialLinks {
  /** platform key -> stored URL, for every connection that has a URL. */
  byPlatform: Record<string, string>;
  /** Number of distinct connected platforms (== Object.keys(byPlatform).length). */
  count: number;
}

/**
 * Normalize a pasted URL for a given platform, mirroring the connections route's
 * parsing. For spotify/youtube we PARSE (pure string work, no network) so a
 * clean platform_id can be stored and an obviously-wrong link can be rejected.
 *
 * @returns the cleaned `url` (trimmed) and an optional `platformId`, or `null`
 *   when the input cannot be parsed into a valid link for that platform.
 */
export function normalizeSocialUrl(
  platform: string,
  url: string,
): { url: string; platformId: string | null } | null {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return null;

  if (platform === 'spotify') {
    const artistId = extractSpotifyArtistId(trimmed);
    if (!artistId) return null;
    return { url: trimmed, platformId: artistId };
  }
  if (platform === 'youtube') {
    const info = extractYouTubeChannelInfo(trimmed);
    if (!info) return null;
    return { url: trimmed, platformId: info.value };
  }
  // All other platforms are link-only: store the URL as both the link and id,
  // exactly like the connections route's `else` branch (platformId = url).
  return { url: trimmed, platformId: trimmed };
}

/**
 * Read the artist's unified social links from platform_connections.
 *
 * Only rows that actually carry a URL count — a connection row with a null/empty
 * platform_url is ignored (it contributes nothing the profile can link to).
 *
 * @param db     Supabase client (user-scoped or service).
 * @param userId The owning user's id.
 */
export async function getUnifiedSocialLinks(
  db: Client,
  userId: string,
): Promise<UnifiedSocialLinks> {
  const { data, error } = await db
    .from('platform_connections')
    .select('platform, platform_url')
    .eq('user_id', userId);

  if (error) throw error;

  const byPlatform: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ platform: string; platform_url: string | null }>) {
    const link = (row.platform_url ?? '').trim();
    if (row.platform && link) byPlatform[row.platform] = link;
  }

  // Legacy fallback (transition): merge in profiles.social_links entries for any
  // platform NOT yet migrated into platform_connections, so existing artists'
  // links still show on their public profile + count toward completion until
  // their next profile save (or a backfill) writes them through. Real
  // platform_connections rows always win; platform_connections stays the
  // canonical WRITE target. The metrics pipeline reads platform_connections
  // directly (not this helper), so it is unaffected by this read-side merge.
  try {
    const { data: prof } = await db
      .from('profiles')
      .select('social_links')
      .eq('user_id', userId)
      .maybeSingle();
    const legacy = (prof?.social_links ?? {}) as Record<string, unknown>;
    if (legacy && typeof legacy === 'object') {
      for (const [legacyKey, rawVal] of Object.entries(legacy)) {
        const platform = LEGACY_KEY_MAP[legacyKey];
        if (!platform || byPlatform[platform]) continue;
        const link = typeof rawVal === 'string' ? rawVal.trim() : '';
        if (link) byPlatform[platform] = link;
      }
    }
  } catch {
    // Best-effort: a profiles read failure must not break link display/count.
  }

  return { byPlatform, count: Object.keys(byPlatform).length };
}

/**
 * Upsert a single social link into platform_connections.
 *
 * - An EMPTY url deletes that platform's row (clearing a link).
 * - A non-empty url is normalized via {@link normalizeSocialUrl}; an unparseable
 *   link throws so the caller can surface a useful error.
 * - The row is written with auto_fetch_enabled = false to keep it inert in the
 *   metrics-fetch cron, matching the connections route (every link is recorded
 *   by the weekly agent run, not by an API auto-fetch).
 *
 * Conflict target is (user_id, platform) — the table's UNIQUE constraint.
 *
 * @param db       Supabase client (user-scoped or service).
 * @param userId   The owning user's id.
 * @param platform A canonical platform key (see SOCIAL_PLATFORM_KEYS).
 * @param url      The pasted URL; empty/whitespace deletes the connection.
 */
export async function upsertSocialLink(
  db: Client,
  userId: string,
  platform: string,
  url: string,
): Promise<void> {
  const trimmed = (url ?? '').trim();

  // Empty url => delete the platform's row.
  if (!trimmed) {
    const { error } = await db
      .from('platform_connections')
      .delete()
      .eq('user_id', userId)
      .eq('platform', platform);
    if (error) throw error;
    return;
  }

  const normalized = normalizeSocialUrl(platform, trimmed);
  if (!normalized) {
    throw new Error(`Could not parse ${platform} URL: ${trimmed}`);
  }

  const { error } = await db.from('platform_connections').upsert(
    {
      user_id: userId,
      platform,
      platform_id: normalized.platformId,
      platform_url: normalized.url,
      // Inert in the fetch-metrics cron — links are recorded by the weekly
      // agent run, never by an API auto-fetch. Matches app/api/hub/connections.
      auto_fetch_enabled: false,
      last_fetched_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,platform' },
  );
  if (error) throw error;
}

/**
 * Backfill unified social links from the legacy profiles.social_links JSONB.
 *
 * Reads the legacy blob (shape: { spotify, appleMusic, instagram, facebook,
 * youtube, soundcloud, tiktok, twitter }) and upserts any present, parseable URL
 * into platform_connections under its canonical key (appleMusic -> apple_music).
 *
 * IDEMPOTENT: platforms already present in platform_connections are skipped, so
 * running this repeatedly never clobbers a connection the artist set up directly
 * and never double-counts.
 *
 * @returns the number of links newly added to platform_connections.
 */
export async function backfillSocialLinksFromProfile(
  db: Client,
  userId: string,
): Promise<number> {
  // 1. Read the legacy blob.
  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('social_links')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileErr) throw profileErr;

  const legacy = (profile?.social_links ?? {}) as Record<string, unknown>;
  if (!legacy || typeof legacy !== 'object') return 0;

  // 2. Find which platforms already have a REAL platform_connections row (query
  // the table directly, NOT getUnifiedSocialLinks — that helper now merges the
  // legacy blob, which would make this think every legacy link is already
  // migrated and skip the backfill entirely). Skip genuinely-connected platforms
  // so this stays idempotent.
  const { data: connRows } = await db
    .from('platform_connections')
    .select('platform')
    .eq('user_id', userId);
  const alreadyConnected = new Set(
    ((connRows ?? []) as Array<{ platform: string }>).map((r) => r.platform),
  );

  // 3. Upsert each present, parseable, not-yet-connected legacy link.
  let added = 0;
  for (const [legacyKey, rawValue] of Object.entries(legacy)) {
    const platform = LEGACY_KEY_MAP[legacyKey];
    if (!platform) continue; // unknown legacy key — ignore
    if (alreadyConnected.has(platform)) continue; // already connected — skip

    const url = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!url) continue;
    const normalized = normalizeSocialUrl(platform, url);
    if (!normalized) continue; // unparseable — skip rather than store junk

    await upsertSocialLink(db, userId, platform, url);
    alreadyConnected.add(platform); // guard against duplicate legacy keys
    added += 1;
  }

  return added;
}
