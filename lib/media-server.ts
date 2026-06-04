// lib/media-server.ts
//
// Server-only Media Booking Hub helpers. Same boundary rule as
// `events-server.ts` and `bands-server.ts`: imports the service Supabase
// client, so it MUST NOT be imported from any client component.
//
// Pure helpers (types, visibility rules, formatters) live in `lib/media.ts`
// and are safe for client components.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase/server';
import type { MediaOffering, ViewerEligibility } from './media';
import { isOfferingVisibleTo } from './media';
import type { CreditKind, MediaCreditBalance } from './media-credits';
import { CREDIT_KIND_LABELS, SCHEDULABLE_CREDIT_KINDS } from './media-credits';

// ============================================================
// Catalog reads
// ============================================================

/**
 * All active offerings, ordered by `sort_order`. The public `/media` page
 * loads this and renders the catalog with prices hidden. The dashboard page
 * loads this and renders prices.
 *
 * Visibility rules (solo viewer can't see band offerings) are enforced at the
 * page layer via `isOfferingVisibleTo` — keeping the DB call simple and
 * cacheable. RLS already excludes `is_active = false` rows for non-admins.
 */
export async function getActiveOfferings(
  client?: SupabaseClient,
): Promise<MediaOffering[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('media_offerings')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[media] getActiveOfferings error:', error);
    return [];
  }
  return (data || []) as MediaOffering[];
}

/**
 * Convenience: get the active catalog already filtered for a specific viewer.
 * Solo + anonymous viewers receive only `solo` and `both` offerings; band
 * viewers receive everything.
 *
 * Most pages will call this rather than `getActiveOfferings` + filter — but
 * the underlying primitive is exposed for the admin UI which wants to see
 * everything regardless of who's logged in.
 */
export async function getOfferingsForViewer(
  viewer: ViewerEligibility,
  client?: SupabaseClient,
): Promise<MediaOffering[]> {
  const all = await getActiveOfferings(client);
  return all.filter((o) => isOfferingVisibleTo(o, viewer));
}

/**
 * Single offering by slug — used on the offering detail page where the user
 * either reviews + checks out (logged in) or sees the public blurb (logged
 * out).
 *
 * Does NOT enforce visibility — callers decide whether a solo user lands on a
 * band-only offering URL gets a 404 or a "members only" message.
 */
export async function getOfferingBySlug(
  slug: string,
  client?: SupabaseClient,
): Promise<MediaOffering | null> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('media_offerings')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return (data as MediaOffering | null) ?? null;
}

/**
 * Admin-side: every row including inactive ones, ordered by sort_order.
 * Used by the (forthcoming) admin CRUD tab to manage the catalog.
 */
export async function getAllOfferingsForAdmin(
  client?: SupabaseClient,
): Promise<MediaOffering[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('media_offerings')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[media] getAllOfferingsForAdmin error:', error);
    return [];
  }
  return (data || []) as MediaOffering[];
}

// ============================================================
// Booking reads (skeletons — the booking flow itself ships in Phase C)
// ============================================================

/**
 * Look up a user's media bookings. Returns the most recent first. Reads
 * directly from `media_bookings`; deliverables and discount codes are
 * fetched separately when needed.
 */
export async function getMediaBookingsForUser(
  userId: string,
  client?: SupabaseClient,
): Promise<unknown[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('media_bookings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[media] getMediaBookingsForUser error:', error);
    return [];
  }
  return data || [];
}

/**
 * Remaining studio-hour balance ("gift card" view) for a user. Adds up
 * `(hours_granted - hours_used)` across every credit row they own, including
 * band-attached credits where they're a member.
 *
 * NOTE: This is the user's PERSONAL credit balance only. Band balances are
 * surfaced separately on the band hub via `getStudioCreditsForBand`. We
 * deliberately don't merge them here — different UX surfaces, different
 * permissions.
 */
export async function getStudioCreditBalanceForUser(
  userId: string,
  client?: SupabaseClient,
): Promise<{ hoursRemaining: number; costBasisCents: number }> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('studio_credits')
    .select('hours_granted, hours_used, cost_basis_cents')
    .eq('user_id', userId);

  if (error || !data) {
    if (error) console.error('[media] getStudioCreditBalanceForUser error:', error);
    return { hoursRemaining: 0, costBasisCents: 0 };
  }

  let hoursRemaining = 0;
  let costBasisCents = 0;
  for (const row of data as {
    hours_granted: number;
    hours_used: number;
    cost_basis_cents: number | null;
  }[]) {
    hoursRemaining += Number(row.hours_granted) - Number(row.hours_used);
    costBasisCents += row.cost_basis_cents ?? 0;
  }
  return { hoursRemaining, costBasisCents };
}

/**
 * Per-deliverable media credit balances (short_video / music_video / etc.)
 * for a user and/or their bands. Aggregates remaining = granted − redeemed,
 * grouped by credit_kind, dropping kinds with zero remaining. Powers the Hub
 * "Balance" view + the schedule-a-credit picker. studio_hours are NOT included
 * here — those live in studio_credits (see getStudioCreditBalanceForUser).
 */
export async function getMediaCreditsForOwner(
  opts: { userId?: string | null; bandIds?: string[] },
  client?: SupabaseClient,
): Promise<MediaCreditBalance[]> {
  const supabase = client || createServiceClient();
  const ownerIds: string[] = [];
  if (opts.userId) ownerIds.push(opts.userId);
  const bandIds = opts.bandIds ?? [];

  // Build an OR over user_id + band_id ownership. Empty → no credits.
  if (!opts.userId && bandIds.length === 0) return [];
  const orParts: string[] = [];
  if (opts.userId) orParts.push(`user_id.eq.${opts.userId}`);
  for (const b of bandIds) orParts.push(`band_id.eq.${b}`);

  const { data, error } = await supabase
    .from('media_credits')
    .select('credit_kind, quantity_granted, quantity_redeemed')
    .or(orParts.join(','));

  if (error || !data) {
    if (error) console.error('[media] getMediaCreditsForOwner error:', error);
    return [];
  }

  const byKind = new Map<CreditKind, { remaining: number; granted: number }>();
  for (const row of data as {
    credit_kind: CreditKind;
    quantity_granted: number;
    quantity_redeemed: number;
  }[]) {
    if (row.credit_kind === 'studio_hours') continue; // hours live in studio_credits
    const cur = byKind.get(row.credit_kind) ?? { remaining: 0, granted: 0 };
    cur.remaining += Number(row.quantity_granted) - Number(row.quantity_redeemed);
    cur.granted += Number(row.quantity_granted);
    byKind.set(row.credit_kind, cur);
  }

  void ownerIds; // (kept for readability; ownership encoded in the OR filter)
  return [...byKind.entries()]
    .filter(([, v]) => v.remaining > 0)
    .map(([credit_kind, v]) => ({
      credit_kind,
      label: CREDIT_KIND_LABELS[credit_kind],
      remaining: v.remaining,
      granted: v.granted,
    }));
}

/**
 * Individual schedulable media-credit ROWS (with ids) for the owner — used by
 * the Artist Hub schedule picker. Unlike getMediaCreditsForOwner (which
 * aggregates by kind for the balance view), this returns each credit row so we
 * can POST a specific credit_id to the schedule-request endpoint. Only rows
 * with remaining > 0 and a schedulable kind are returned.
 */
export async function getSchedulableMediaCredits(
  opts: { userId?: string | null; bandIds?: string[] },
  client?: SupabaseClient,
): Promise<Array<{ id: string; credit_kind: CreditKind; tier: string | null; remaining: number; band_id: string | null }>> {
  const supabase = client || createServiceClient();
  const bandIds = opts.bandIds ?? [];
  if (!opts.userId && bandIds.length === 0) return [];
  const orParts: string[] = [];
  if (opts.userId) orParts.push(`user_id.eq.${opts.userId}`);
  for (const b of bandIds) orParts.push(`band_id.eq.${b}`);

  const { data, error } = await supabase
    .from('media_credits')
    .select('id, credit_kind, tier, quantity_granted, quantity_redeemed, band_id')
    .or(orParts.join(','));
  if (error || !data) {
    if (error) console.error('[media] getSchedulableMediaCredits error:', error);
    return [];
  }
  return (data as Array<{ id: string; credit_kind: CreditKind; tier: string | null; quantity_granted: number; quantity_redeemed: number; band_id: string | null }>)
    .map((r) => ({
      id: r.id,
      credit_kind: r.credit_kind,
      tier: r.tier,
      remaining: Number(r.quantity_granted) - Number(r.quantity_redeemed),
      band_id: r.band_id,
    }))
    .filter((r) => r.remaining > 0 && SCHEDULABLE_CREDIT_KINDS.includes(r.credit_kind));
}

/**
 * Same as above for a band. Any member can view the balance.
 */
export async function getStudioCreditBalanceForBand(
  bandId: string,
  client?: SupabaseClient,
): Promise<{ hoursRemaining: number; costBasisCents: number }> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('studio_credits')
    .select('hours_granted, hours_used, cost_basis_cents')
    .eq('band_id', bandId);

  if (error || !data) {
    if (error) console.error('[media] getStudioCreditBalanceForBand error:', error);
    return { hoursRemaining: 0, costBasisCents: 0 };
  }

  let hoursRemaining = 0;
  let costBasisCents = 0;
  for (const row of data as {
    hours_granted: number;
    hours_used: number;
    cost_basis_cents: number | null;
  }[]) {
    hoursRemaining += Number(row.hours_granted) - Number(row.hours_used);
    costBasisCents += row.cost_basis_cents ?? 0;
  }
  return { hoursRemaining, costBasisCents };
}
