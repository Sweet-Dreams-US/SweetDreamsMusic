// lib/meta-social.ts — Facebook Page + Instagram reads for the Social tab and
// the public Instagram feed.
//
// ACCESS REALITY (probed live 2026-07-06):
//   • Instagram (@sweetdreamsmusic.us, IG user 17841477770496396) is readable
//     NOW with the system-user token (instagram_basic).
//   • The Facebook Page (1062672440254662) is still gated until the Page asset
//     is assigned to the system user in Business Settings — Page functions
//     throw PageAccessError (reused from lib/meta-leads) so callers render
//     setup instructions instead of failing.
//
// SERVER ONLY — same env/auth pattern as lib/meta-marketing.ts.

import { createHmac } from 'crypto';
import { SWEET_DREAMS_META, type MetaMarketingConfig } from '@/lib/meta-marketing';
import { PageAccessError } from '@/lib/meta-leads';

const V = 'v25.0';

async function graphGet(path: string, params: Record<string, string> = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const appSecret = process.env.META_APP_SECRET;
  const token = process.env.META_ACCESS_TOKEN;
  if (!appSecret || !token) throw new Error('Meta env missing (META_APP_SECRET / META_ACCESS_TOKEN)');
  const proof = createHmac('sha256', appSecret).update(token).digest('hex');
  const res = await fetch(
    `https://graph.facebook.com/${V}/${path}?` +
    new URLSearchParams({ access_token: token, appsecret_proof: proof, ...params }),
  );
  const body = await res.json();
  if (!res.ok) {
    const msg: string = body?.error?.message ?? String(res.status);
    if (/privileg|permission|access|does not exist|cannot be loaded/i.test(msg)) {
      throw new PageAccessError(path.split('/')[0], msg);
    }
    throw new Error(`Meta ${path}: ${msg}`);
  }
  return body;
}

// ── Instagram (works today) ───────────────────────────────────────────────

export interface IgProfile {
  id: string;
  username: string;
  followers: number;
  mediaCount: number;
}

export interface IgMediaItem {
  id: string;
  caption: string | null;
  mediaType: string;          // IMAGE | VIDEO | CAROUSEL_ALBUM
  mediaUrl: string | null;    // image url (or video file url)
  thumbnailUrl: string | null; // set for VIDEO
  permalink: string;
  timestamp: string;
  likeCount: number | null;
  commentsCount: number | null;
}

export async function getIgProfile(cfg: MetaMarketingConfig = SWEET_DREAMS_META): Promise<IgProfile> {
  const b = await graphGet(cfg.igId, { fields: 'id,username,followers_count,media_count' });
  return {
    id: b.id,
    username: b.username,
    followers: b.followers_count ?? 0,
    mediaCount: b.media_count ?? 0,
  };
}

// 15-minute cache — the public /media page renders this on every visit and IG
// content changes slowly. Keyed per IG user for the multi-studio future.
const igCache = new Map<string, { at: number; data: IgMediaItem[] }>();
const IG_CACHE_MS = 15 * 60 * 1000;

export async function getRecentIgMedia(
  limit = 12,
  cfg: MetaMarketingConfig = SWEET_DREAMS_META,
): Promise<IgMediaItem[]> {
  const key = `${cfg.igId}:${limit}`;
  const hit = igCache.get(key);
  if (hit && Date.now() - hit.at < IG_CACHE_MS) return hit.data;

  const b = await graphGet(`${cfg.igId}/media`, {
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
    limit: String(limit),
  });
  const items: IgMediaItem[] = ((b.data ?? []) as any[]).map((m) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: m.id,
    caption: m.caption ?? null,
    mediaType: m.media_type ?? 'IMAGE',
    mediaUrl: m.media_url ?? null,
    thumbnailUrl: m.thumbnail_url ?? null,
    permalink: m.permalink,
    timestamp: m.timestamp,
    likeCount: typeof m.like_count === 'number' ? m.like_count : null,
    commentsCount: typeof m.comments_count === 'number' ? m.comments_count : null,
  }));
  igCache.set(key, { at: Date.now(), data: items });
  return items;
}

// ── Facebook Page (gated until the Page asset is assigned) ────────────────

export interface PageProfile {
  id: string;
  name: string;
  fanCount: number | null;
  followersCount: number | null;
}

export interface PagePost {
  id: string;
  message: string | null;
  createdTime: string;
  permalink: string | null;
  picture: string | null;
  reactions: number | null;
  comments: number | null;
}

export async function getPageProfile(cfg: MetaMarketingConfig = SWEET_DREAMS_META): Promise<PageProfile> {
  const b = await graphGet(cfg.pageId, { fields: 'id,name,fan_count,followers_count' });
  return {
    id: b.id,
    name: b.name,
    fanCount: b.fan_count ?? null,
    followersCount: b.followers_count ?? null,
  };
}

export async function getRecentPagePosts(
  limit = 10,
  cfg: MetaMarketingConfig = SWEET_DREAMS_META,
): Promise<PagePost[]> {
  const b = await graphGet(`${cfg.pageId}/posts`, {
    fields: 'id,message,created_time,permalink_url,full_picture,reactions.summary(true),comments.summary(true)',
    limit: String(limit),
  });
  return ((b.data ?? []) as any[]).map((p) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: p.id,
    message: p.message ?? null,
    createdTime: p.created_time,
    permalink: p.permalink_url ?? null,
    picture: p.full_picture ?? null,
    reactions: p.reactions?.summary?.total_count ?? null,
    comments: p.comments?.summary?.total_count ?? null,
  }));
}
