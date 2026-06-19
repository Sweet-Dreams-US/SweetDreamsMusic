// lib/profile-slug.ts — derive a public profile slug from a display name.
//
// Artists do NOT choose their slug. It is DERIVED from the display name so the
// public URL (/u/<slug>) always tracks the name the artist shows. slugifyName()
// is the pure transform; deriveUniqueSlug() layers DB uniqueness on top.
//
// Uniqueness is checked against profiles.public_profile_slug, but only across
// OTHER users — re-deriving for the same user must keep returning that user's
// own slug rather than bumping it to "-2" against itself.

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/**
 * Convert a display name into a URL-safe slug.
 *
 * PURE. Rules, in order:
 *   1. lowercase
 *   2. trim leading/trailing whitespace
 *   3. replace any run of whitespace with a single '-'
 *   4. strip every char that isn't [a-z0-9-]
 *   5. collapse runs of '-' into one
 *   6. trim leading/trailing '-'
 *   7. fall back to 'user' if nothing usable remains (e.g. emoji-only name)
 *
 * @example slugifyName("Lil  Uzi Vert!")   => "lil-uzi-vert"
 * @example slugifyName("  J. Cole  ")        => "j-cole"
 * @example slugifyName("🎵🎵")               => "user"
 */
export function slugifyName(name: string): string {
  const slug = (name ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // whitespace runs -> single hyphen
    .replace(/[^a-z0-9-]/g, '') // drop anything not url-safe
    .replace(/-+/g, '-') // collapse hyphen runs
    .replace(/^-+|-+$/g, ''); // trim edge hyphens

  return slug || 'user';
}

/**
 * Derive a slug from `displayName` that is unique across all OTHER users'
 * profiles.public_profile_slug.
 *
 * Slugifies the name, then — if the base slug is taken by a DIFFERENT user —
 * appends -2, -3, ... until a free slug is found. A slug owned by
 * `currentUserId` does NOT count as a conflict, so re-deriving for the same user
 * (e.g. on a name change that slugifies identically) returns the base slug
 * unchanged instead of needlessly bumping it.
 *
 * NOTE: this is a read-then-pick; it does not write. The caller persists the
 * returned slug. There is an inherent TOCTOU race with concurrent signups —
 * rely on the DB's UNIQUE(public_profile_slug) constraint as the final guard
 * (and retry on conflict if needed). For interactive profile edits the race is
 * not a practical concern.
 *
 * @param db            Supabase client (user-scoped or service).
 * @param displayName   The artist's display name to derive from.
 * @param currentUserId The user the slug is for; their own slug is not a conflict.
 * @returns a slug guaranteed unique vs other users at read time.
 */
export async function deriveUniqueSlug(
  db: Client,
  displayName: string,
  currentUserId: string,
): Promise<string> {
  const base = slugifyName(displayName);

  // Pull every slug that collides with base or its numbered variants, owned by
  // someone OTHER than the current user. One query, then resolve in memory.
  const { data, error } = await db
    .from('profiles')
    .select('public_profile_slug, user_id')
    .neq('user_id', currentUserId)
    .like('public_profile_slug', `${base}%`);
  if (error) throw error;

  const taken = new Set(
    ((data ?? []) as Array<{ public_profile_slug: string | null }>)
      .map((r) => r.public_profile_slug)
      .filter((s): s is string => !!s),
  );

  if (!taken.has(base)) return base;

  // base is taken by another user — find the first free numbered variant.
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
