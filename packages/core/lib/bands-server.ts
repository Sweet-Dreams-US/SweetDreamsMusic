// lib/bands-server.ts
//
// Server-only band helpers. Everything in this file either touches the service
// Supabase client or depends on modules that do (which is why it can't live in
// lib/bands.ts — that file must be safe to import from client components).
//
// Import rule:
//   - Client components and browser-safe modules → `@/lib/bands`
//     (types + pure helpers like memberHasFlag, isOwner, bandSlugFromName, etc.)
//   - Server components, route handlers, server actions → `@/lib/bands-server`
//     (the async DB functions below) — and still `@/lib/bands` for types/helpers.
//
// Why the split: `createServiceClient` transitively imports `next/headers`,
// which Turbopack refuses to bundle into a client component. Before this
// split, client components that only wanted `type BandMember` or the pure
// `memberHasFlag` function dragged the entire service client through the
// import graph and broke the build. Splitting by runtime boundary, not by
// conceptual category, is the standard Next.js RSC pattern.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase/server';
import type { Band, BandInvite, BandMember, BandMembership } from './bands';

// ============================================================
// Queries
// ============================================================

/**
 * Get the current user's membership (and band) for every band they belong to.
 * Ordered with bands the user owns first, then alphabetical.
 */
export async function getUserBands(
  userId: string,
  client?: SupabaseClient
): Promise<BandMembership[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('band_members')
    .select('*, band:bands(*)')
    .eq('user_id', userId)
    .order('role', { ascending: true })
    .order('joined_at', { ascending: false });

  if (error) {
    console.error('[bands] getUserBands error:', error);
    return [];
  }

  const rows = (data || []) as (BandMember & { band: Band | null })[];
  const withBand = rows.filter((r): r is BandMembership => !!r.band);

  // Sort owners first (supabase ordering on role didn't do this cleanly —
  // 'admin' < 'member' < 'owner' alphabetically puts owners last, not first).
  withBand.sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1;
    if (a.role !== 'owner' && b.role === 'owner') return 1;
    return a.band.display_name.localeCompare(b.band.display_name);
  });

  return withBand;
}

/**
 * Get a band by ID, including the list of members. Returns null if the band
 * doesn't exist.
 */
export async function getBandWithMembers(
  bandId: string,
  client?: SupabaseClient
): Promise<{ band: Band; members: BandMember[] } | null> {
  const supabase = client || createServiceClient();
  const { data: band, error: bandErr } = await supabase
    .from('bands')
    .select('*')
    .eq('id', bandId)
    .single();
  if (bandErr || !band) return null;

  const { data: members } = await supabase
    .from('band_members')
    .select('*')
    .eq('band_id', bandId)
    .order('role', { ascending: true })
    .order('joined_at', { ascending: true });

  return { band: band as Band, members: (members || []) as BandMember[] };
}

/**
 * Fetch a single membership record for a (band, user) pair. Null if the user
 * is not a member of the band.
 */
export async function getMembership(
  bandId: string,
  userId: string,
  client?: SupabaseClient
): Promise<BandMember | null> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('band_members')
    .select('*')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as BandMember | null) ?? null;
}

/**
 * Get pending invites addressed to an email (case-insensitive).
 */
export async function getPendingInvitesForEmail(
  email: string,
  client?: SupabaseClient
): Promise<(BandInvite & { band: Band })[]> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('band_invites')
    .select('*, band:bands(*)')
    .ilike('invited_email', email)
    .is('accepted_at', null)
    .is('rejected_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  const rows = (data || []) as (BandInvite & { band: Band | null })[];
  return rows.filter((r): r is BandInvite & { band: Band } => !!r.band);
}

/**
 * Get pending invites for a band (for the members management UI).
 */
export async function getPendingInvitesForBand(
  bandId: string,
  client?: SupabaseClient
): Promise<BandInvite[]> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('band_invites')
    .select('*')
    .eq('band_id', bandId)
    .is('accepted_at', null)
    .is('rejected_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  return (data || []) as BandInvite[];
}

// ============================================================
// Slug generation (server-side because it queries the bands table)
// ============================================================

/**
 * Reserved slugs that would collide with App Router static segments under
 * /bands/. A band named "Accept" must not claim /bands/accept because that's
 * the invite acceptance route. Keep this in sync when adding new static
 * routes under app/bands/.
 */
const RESERVED_BAND_SLUGS = new Set<string>([
  'accept',  // /bands/accept/[token]
  'new',     // reserved for future /bands/new if we add public band creation
  'edit',
  'admin',
  'api',
]);

/**
 * Produce a unique slug by appending -2, -3, ... if base is taken OR reserved.
 * Pair with `bandSlugFromName` from `@/lib/bands` to generate the base first.
 */
export async function uniqueBandSlug(
  base: string,
  client?: SupabaseClient
): Promise<string> {
  const supabase = client || createServiceClient();
  const safeBase = base || 'band';
  let candidate = safeBase;
  let suffix = 1;

  while (true) {
    const isReserved = RESERVED_BAND_SLUGS.has(candidate);
    if (isReserved) {
      suffix += 1;
      candidate = `${safeBase}-${suffix}`;
      continue;
    }
    const { data } = await supabase
      .from('bands')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    suffix += 1;
    candidate = `${safeBase}-${suffix}`;
  }
}
