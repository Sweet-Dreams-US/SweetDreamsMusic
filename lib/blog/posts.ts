// lib/blog/posts.ts
//
// File based blog. Posts are markdown files in content/blog, named
// YYYY-MM-DD-<slug>.md, written there by the Sweet Dreams publishing routine
// (see the blog format contract). Nothing here talks to a database and no post
// text lives in code.
//
// RELEASE GATE: a post is visible on and after its `release_on`, judged in Fort
// Wayne time. Before that its page is a 404 and it is left out of /blog, the
// sitemap, the RSS feed and the navigation check. The gate is evaluated when a
// page renders, never baked in at build, so a post appears on its day without a
// deploy (pages revalidate at least hourly, see the `revalidate` exports).
//
// The files themselves cannot change inside one deployment, so the parsed list
// is memoised per server instance in production. Only the date comparison runs
// per request.

import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');
const TIME_ZONE = 'America/Indiana/Indianapolis';

export interface BlogSource {
  title: string;
  author?: string;
  url: string;
}

export interface BlogPost {
  post_id: string;
  seq: number;
  title: string;
  slug: string;
  /** YYYY-MM-DD. Compared as a plain string with today's Fort Wayne date. */
  release_on: string;
  description: string;
  reading_minutes: number;
  sources: BlogSource[];
  /** Markdown after the front matter block. */
  body: string;
}

/** Today's date in Fort Wayne time as YYYY-MM-DD (en-CA formats that way). */
export function todayInFortWayne(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isReleased(post: Pick<BlogPost, 'release_on'>, today: string = todayInFortWayne()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(post.release_on) && post.release_on <= today;
}

/** "November 2, 2026" from a YYYY-MM-DD string, with no time zone drift. */
export function formatReleaseDate(releaseOn: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${releaseOn}T00:00:00Z`));
}

/* ------------------------------------------------------------ Front matter */

type FmValue = string | Record<string, string>[];

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = v.slice(1, -1);
      return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
    }
  }
  return v;
}

/**
 * Small parser for the fixed front matter shape in the blog format contract:
 * `key: value` scalars plus one list of maps (`sources`). Not general YAML.
 */
function parseFrontMatter(raw: string): Record<string, FmValue> {
  const lines = raw.split('\n');
  const out: Record<string, FmValue> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const [, key, rest] = m;
    if (rest.trim() !== '') {
      out[key] = unquote(rest);
      i++;
      continue;
    }
    const items: Record<string, string>[] = [];
    let j = i + 1;
    while (j < lines.length && /^\s*-\s/.test(lines[j])) {
      const item: Record<string, string> = {};
      const first = lines[j].match(/^\s*-\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (first) item[first[1]] = unquote(first[2]);
      j++;
      while (j < lines.length && /^\s+[A-Za-z_]/.test(lines[j]) && !/^\s*-\s/.test(lines[j])) {
        const kv = lines[j].match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (kv) item[kv[1]] = unquote(kv[2]);
        j++;
      }
      items.push(item);
    }
    out[key] = items;
    i = items.length ? j : i + 1;
  }
  return out;
}

function estimateMinutes(body: string): number {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function parsePost(filename: string, rawFile: string): BlogPost | null {
  const raw = rawFile.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    console.error(`[blog] ${filename}: no front matter block, skipped`);
    return null;
  }
  const fm = parseFrontMatter(match[1]);
  const str = (k: string) => (typeof fm[k] === 'string' ? (fm[k] as string) : '');

  const post_id = str('post_id');
  const title = str('title');
  const slug = str('slug');
  if (!post_id || !title || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error(`[blog] ${filename}: missing post_id, title or a valid slug, skipped`);
    return null;
  }

  const releaseRaw = str('release_on');
  const dateMatch = releaseRaw.match(/^\d{4}-\d{2}-\d{2}/);
  const release_on = dateMatch ? dateMatch[0] : '';

  const rawSources = fm.sources;
  const sources: BlogSource[] = Array.isArray(rawSources)
    ? rawSources
        .filter((s) => s.title && s.url)
        .map((s) => ({ title: s.title, author: s.author || undefined, url: s.url }))
    : [];

  const body = match[2].trim();
  return {
    post_id,
    seq: Number(str('seq')) || 0,
    title,
    slug,
    release_on,
    description: str('description'),
    reading_minutes: Number(str('reading_minutes')) || estimateMinutes(body),
    sources,
    body,
  };
}

async function readAllPosts(): Promise<BlogPost[]> {
  let files: string[];
  try {
    files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed = await Promise.all(
    files.map(async (file) => parsePost(file, await readFile(path.join(BLOG_DIR, file), 'utf8'))),
  );
  // One post per post_id; a dated copy wins over an undated one.
  const byId = new Map<string, BlogPost>();
  for (const p of parsed) {
    if (!p) continue;
    const existing = byId.get(p.post_id);
    if (!existing || (!existing.release_on && p.release_on)) byId.set(p.post_id, p);
  }
  return [...byId.values()];
}

let memo: Promise<BlogPost[]> | null = null;

function loadAllPosts(): Promise<BlogPost[]> {
  if (process.env.NODE_ENV !== 'production') return readAllPosts(); // dev: always fresh
  if (!memo) {
    memo = readAllPosts().catch((err) => {
      memo = null; // never cache a failed read
      throw err;
    });
  }
  return memo;
}

/** Newest release first; on the same day, the higher seq first. */
function newestFirst(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) =>
    a.release_on === b.release_on ? b.seq - a.seq : a.release_on < b.release_on ? 1 : -1,
  );
}

/** Released posts only, newest first. The index, sitemap and feed all use this. */
export async function getReleasedPosts(): Promise<BlogPost[]> {
  const today = todayInFortWayne();
  return newestFirst((await loadAllPosts()).filter((p) => isReleased(p, today)));
}

/** One released post, or null (so the page can 404) before its day or if it does not exist. */
export async function getReleasedPost(slug: string): Promise<BlogPost | null> {
  return (await getReleasedPosts()).find((p) => p.slug === slug) ?? null;
}

/** True once at least one post has reached its release date. Drives the Blog nav link. */
export async function hasReleasedPosts(): Promise<boolean> {
  try {
    const today = todayInFortWayne();
    return (await loadAllPosts()).some((p) => isReleased(p, today));
  } catch (err) {
    console.error('[blog] could not read content/blog:', err);
    return false;
  }
}
