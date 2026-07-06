// lib/media-deals-server.ts — admin-managed promotional deals (media_deals).
//
// A deal overrides ONE offering's price on every ARTIST-FACING surface while
// active: lib/media-server's loaders call applyDealsToOfferings, so the
// catalog card, configure form, cart, and checkout all show/charge the deal
// price from a single chokepoint — the offering's real base price is never
// edited. Deals also carry the marketing face (title/tagline) the /media page
// and hub Media tab render as red promo banners.
//
// SERVER ONLY (same boundary as lib/media-server).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase/server';
import type { MediaOffering } from './media';

export interface MediaDeal {
  id: string;
  offering_id: string;
  title: string;
  tagline: string | null;
  deal_price_cents: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

/** A deal that is active AND inside its optional date window right now. */
export function dealIsLive(d: MediaDeal, now = new Date()): boolean {
  if (!d.active) return false;
  if (d.starts_at && new Date(d.starts_at) > now) return false;
  if (d.ends_at && new Date(d.ends_at) <= now) return false;
  return true;
}

/** All currently-live deals. */
export async function getActiveDeals(client?: SupabaseClient): Promise<MediaDeal[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('media_deals')
    .select('id, offering_id, title, tagline, deal_price_cents, active, starts_at, ends_at')
    .eq('active', true);
  if (error) {
    console.error('[media-deals] getActiveDeals error:', error);
    return [];
  }
  return ((data ?? []) as MediaDeal[]).filter((d) => dealIsLive(d));
}

/**
 * Overlay live deals onto offerings: the matched offering's price_cents
 * becomes the deal price, and the deal's marketing face is attached as
 * `offering.deal` (with the original price preserved for strikethrough UI).
 * Pure — safe to call with any offerings array.
 */
export function applyDealsToOfferings(
  offerings: MediaOffering[],
  deals: MediaDeal[],
): MediaOffering[] {
  if (deals.length === 0) return offerings;
  const byOffering = new Map(deals.map((d) => [d.offering_id, d]));
  return offerings.map((o) => {
    const deal = byOffering.get(o.id);
    if (!deal) return o;
    return {
      ...o,
      price_cents: deal.deal_price_cents,
      deal: {
        id: deal.id,
        title: deal.title,
        tagline: deal.tagline,
        deal_price_cents: deal.deal_price_cents,
        original_price_cents: o.price_cents,
      },
    };
  });
}
