// lib/bands.ts
//
// Client-safe band module: TypeScript types + pure helper functions.
//
// This file MUST NOT import anything that reaches `next/headers`, `next/cache`,
// the service Supabase client, server-only env vars, or any other server-only
// runtime. Client components (`'use client'` files) import types and helpers
// from here, and a single bad transitive edge breaks the entire client bundle.
//
// For async DB functions that need the service client, see `@/lib/bands-server`.

// ============================================================
// Types
// ============================================================

export type BandRole = 'owner' | 'admin' | 'member';

export type BandPermissionFlag =
  | 'can_edit_public_page'
  | 'can_book_sessions'
  | 'can_book_band_sessions'
  | 'can_manage_members';

export type Band = {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  profile_picture_url: string | null;
  cover_image_url: string | null;
  genre: string | null;
  hometown: string | null;
  spotify_link: string | null;
  apple_music_link: string | null;
  instagram_link: string | null;
  facebook_link: string | null;
  youtube_link: string | null;
  soundcloud_link: string | null;
  tiktok_link: string | null;
  twitter_link: string | null;
  custom_links: Record<string, string> | null;
  is_public: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type BandMember = {
  id: string;
  band_id: string;
  user_id: string;
  role: BandRole;
  stage_name: string | null;
  band_role: string | null;
  can_edit_public_page: boolean;
  can_book_sessions: boolean;
  can_book_band_sessions: boolean;
  can_manage_members: boolean;
  joined_at: string;
};

export type BandMembership = BandMember & { band: Band };

export type BandInvite = {
  id: string;
  band_id: string;
  invited_email: string;
  invited_by: string;
  token: string;
  role: 'admin' | 'member';
  stage_name: string | null;
  band_role: string | null;
  can_edit_public_page: boolean;
  can_book_sessions: boolean;
  can_book_band_sessions: boolean;
  can_manage_members: boolean;
  expires_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  created_at: string;
};

// ============================================================
// Permission checks (pure, runtime-agnostic)
// ============================================================

/**
 * Owners implicitly have every permission. Admins and members are governed
 * by their individual flags. Use this everywhere a permission check happens
 * so the owner-is-god rule stays consistent.
 */
export function memberHasFlag(member: BandMember, flag: BandPermissionFlag): boolean {
  if (member.role === 'owner') return true;
  return member[flag] === true;
}

export function isOwner(member: BandMember | null | undefined): boolean {
  return member?.role === 'owner';
}

export function isOwnerOrAdmin(member: BandMember | null | undefined): boolean {
  return member?.role === 'owner' || member?.role === 'admin';
}

// ============================================================
// Slug + token helpers (pure, no DB access)
// ============================================================

/**
 * Kebab-case a band name. Strips non-alphanumerics, collapses spaces.
 * Doesn't check uniqueness — pair with `uniqueBandSlug` from `@/lib/bands-server`.
 */
export function bandSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Opaque random token for invite URLs. 32 bytes base64url ≈ 43 chars.
 * Uses WebCrypto (available in both Node and browser) and `Buffer` (polyfilled
 * for the browser by Next.js / Turbopack when needed).
 */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
