// lib/slug.ts
// Readable URL slugs for beats. slugify() + beatHref() are pure (safe to import
// from client or server). generateUniqueBeatSlug() checks the beats table for
// collisions and is server-only (it takes a Supabase client).
import type { SupabaseClient } from '@supabase/supabase-js';

/** Turn a title into a URL-safe slug: lowercase, hyphenated, alphanumerics only. */
export function slugify(input: string): string {
  const s = (input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, 60)
    .replace(/-+$/g, ''); // re-trim after the length cap
  return s || 'beat';
}

/** True if the string looks like a v4-ish UUID (so the route can branch slug vs id). */
export function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Canonical path for a beat — the slug if present, else the UUID (back-compat). */
export function beatHref(beat: { slug?: string | null; id: string }): string {
  return `/beats/${beat.slug || beat.id}`;
}

/**
 * Generate a slug that is unique within the beats table. Appends -2, -3, … on
 * collision (checked against the DB). Pass excludeId when re-slugging an
 * existing beat so it doesn't collide with itself.
 */
export async function generateUniqueBeatSlug(
  db: SupabaseClient,
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  let n = 1;
  for (let i = 0; i < 50; i++) {
    let q = db.from('beats').select('id').eq('slug', candidate).limit(1);
    if (excludeId) q = q.neq('id', excludeId);
    const { data } = await q;
    if (!data || data.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  // Effectively unreachable, but never return a colliding slug.
  return `${base}-${Date.now()}`;
}
