// lib/media.ts
//
// Media Booking Hub — types + pure helpers. Safe to import from anywhere
// (client components, server components, route handlers). NO Supabase, NO
// next/headers, NO secrets in this file.
//
// Server-only DB fetchers live in `lib/media-server.ts`.
//
// Spec: SweetDreamsMusicVault/Features/Media-Booking-Hub.md

// ============================================================
// Domain types — mirror the schema in 039_media_hub.sql
// ============================================================

/** What kind of catalog row this is. */
export type MediaOfferingKind = 'standalone' | 'package';

/**
 * Who's allowed to see / buy this offering.
 *
 *  - `solo`              — solo artists only
 *  - `band`              — bands only (e.g. Sweet Spot — Band)
 *  - `both`              — visible + bookable by anyone
 *  - `band-by-request`   — only visible to bands AND has no fixed price
 *                          (e.g. custom Single/EP/Album for a band)
 *
 * Cole's rule (2026-04-24): solo viewers must NEVER see `band` or
 * `band-by-request` offerings. Hide them entirely — no upsell tease tile.
 */
export type MediaOfferingEligibility = 'solo' | 'band' | 'both' | 'band-by-request';

/** Viewer status used to filter the catalog. Derived from band membership. */
export type ViewerEligibility = 'solo' | 'band' | 'anonymous';

/**
 * The shape of `media_offerings.components` JSONB. The configurator wizard
 * walks each slot, applying severity options or skip rules to compute the
 * final price. Standalone offerings have `components = null`.
 */
export interface OfferingComponentSlot {
  /** Stable identifier the configurator references. */
  key: string;
  /** Type of slot determines how the wizard renders it. */
  kind:
    | 'hours'      // fixed studio time, e.g. recording_hours value=3
    | 'unit'       // a fixed count of a thing (3 shorts, 1 cover)
    | 'per_song'   // count_per song — multiplies by song count downstream
    | 'on_shoot'   // photos taken alongside other shoots, no separate cost
    | 'flexible'   // open-ended ("as many hours as needed")
    | 'included';  // free add-on baked into price (marketing in Sweet Spot Individual)
  /** Display label shown in the configurator. */
  label: string;
  /** For `hours` slots, the included hours. */
  value?: number;
  /** For `unit` slots, how many. */
  count?: number;
  /** For `per_song` slots, the multiplier. */
  count_per?: number;
  /** Whether the wizard offers a "skip this" option. */
  skippable?: boolean;
  /** Discount applied if the user skips. Only present when skippable=true. */
  skip_delta_cents?: number;
  /** Severity tiers a user can choose between. Each delta adds to base price. */
  options?: Array<{ tier: string; delta: number }>;
}

export interface OfferingComponents {
  slots: OfferingComponentSlot[];
}

/** Full row shape from `media_offerings`. */
export interface MediaOffering {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: MediaOfferingKind;
  eligibility: MediaOfferingEligibility;
  price_cents: number | null;
  price_range_low_cents: number | null;
  price_range_high_cents: number | null;
  components: OfferingComponents | null;
  studio_hours_included: number;
  public_blurb: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Visibility — central rules used everywhere we render the catalog
// ============================================================

/**
 * Map a viewer's band-membership state to their viewer eligibility. The
 * caller is responsible for deciding whether a "logged-out viewer with band
 * membership" is even possible (it's not on this site, but defensive design).
 */
export function viewerEligibilityFromBands(opts: {
  authenticated: boolean;
  bandCount: number;
}): ViewerEligibility {
  if (!opts.authenticated) return 'anonymous';
  return opts.bandCount > 0 ? 'band' : 'solo';
}

/**
 * Should this offering be shown to this viewer? Implements Cole's rule:
 * "Don't even show any of the band options to people that aren't in a band."
 *
 *   anonymous + solo viewers  →  see solo + both     (hide band, band-by-request)
 *   band viewers              →  see everything
 */
export function isOfferingVisibleTo(
  offering: Pick<MediaOffering, 'eligibility' | 'is_active'>,
  viewer: ViewerEligibility,
): boolean {
  if (!offering.is_active) return false;

  if (offering.eligibility === 'both' || offering.eligibility === 'solo') return true;

  // Both 'band' and 'band-by-request' require the viewer to be in a band.
  return viewer === 'band';
}

// ============================================================
// Pricing helpers — pure formatting
// ============================================================

/**
 * Render an offering's price as a human-readable string. Public surface (the
 * /media page) calls this with `hidePrices: true` to render "Members only" /
 * "Inquire" instead of the actual dollar amount.
 *
 *   • Fixed price          → "$850"
 *   • Range                → "$1,500 – $5,000"
 *   • Inquire (price=null) → "Inquire"
 *   • hidePrices=true      → "Members only" (or "Inquire" if also null)
 *
 * We use Intl.NumberFormat so locales other than en-US still render sanely
 * (low-priority but cheap).
 */
export function formatOfferingPrice(
  offering: Pick<
    MediaOffering,
    'price_cents' | 'price_range_low_cents' | 'price_range_high_cents'
  >,
  opts?: { hidePrices?: boolean },
): string {
  const isInquire =
    offering.price_cents == null &&
    offering.price_range_low_cents == null &&
    offering.price_range_high_cents == null;

  // Inquire wins regardless of hidePrices — the user sees the same "ask us"
  // message whether or not they're logged in. No surprise paywall.
  if (isInquire) return 'Inquire';

  if (opts?.hidePrices) return 'Members only';

  const fmt = (cents: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);

  if (
    offering.price_range_low_cents != null &&
    offering.price_range_high_cents != null
  ) {
    return `${fmt(offering.price_range_low_cents)} – ${fmt(offering.price_range_high_cents)}`;
  }

  if (offering.price_cents != null) return fmt(offering.price_cents);

  return 'Inquire';
}

/**
 * Group offerings into the three sections the catalog UI renders:
 *
 *   • packages   — kind='package' (Single Drop, EP, Album, Sweet Spot, etc.)
 *   • services   — kind='standalone' (shorts, MVs, photo, cover, marketing)
 *
 * Order within each group preserves `sort_order`.
 */
export function groupOfferings(offerings: MediaOffering[]): {
  packages: MediaOffering[];
  services: MediaOffering[];
} {
  const sorted = [...offerings].sort((a, b) => a.sort_order - b.sort_order);
  return {
    packages: sorted.filter((o) => o.kind === 'package'),
    services: sorted.filter((o) => o.kind === 'standalone'),
  };
}
