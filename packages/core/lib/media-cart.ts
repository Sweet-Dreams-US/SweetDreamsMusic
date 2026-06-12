// lib/media-cart.ts
//
// Pure types for the new cart-pattern media booking UX. The cart is a
// client-side staging area: each item captures an offering + the buyer's
// configurator choices (for packages) + project details (artist / songs /
// vibe / etc). Cart submit POSTs the whole array to /api/media/checkout
// which creates a single Stripe session with multiple line items, then
// the webhook fans out into one media_bookings row per item.
//
// Why client-only state (no DB persistence pre-checkout): the cart is
// ephemeral by design. If the buyer closes the tab, they re-pick — same
// as any e-commerce shopping cart. A page refresh wipes it; that's
// acceptable for a low-frequency, high-consideration purchase.
//
// Pure module — safe to import from client + server. No Supabase, no
// next/headers.

import type { MediaOffering } from './media';
import type { ConfiguredComponents } from './media-config';

// ============================================================
// Project details — collected per cart item
// ============================================================

/**
 * Per-song row in the optional songs breakdown. Buyers toggle on the
 * "Add songs" panel and list each track they want covered with an
 * optional note (e.g. "this is the cover-art name", "shorts will use
 * this song's chorus", etc).
 */
export interface MediaProjectSong {
  title: string;
  notes?: string | null;
}

/**
 * The questionnaire shape collected on each cart item. Mirrors the
 * media_bookings.project_details JSONB the webhook writes.
 *
 * Round 6 (2026-04-28): all fields are optional. Artist name is no
 * longer collected here at all — we already know who the buyer is from
 * their session and write the profile name into the booking server-side.
 * Validation at the cart sidebar is now: phone (from profile or
 * freshly entered) — that's the only true required field, since the
 * team will reach out by phone to plan the rest.
 */
export interface MediaProjectDetails {
  /** Optional title the buyer wants on the project. */
  project_name?: string | null;
  /** Optional one-line summary of songs (kept for back-compat with old bookings). */
  songs?: string | null;
  /** Optional structured per-song breakdown — preferred over songs string. */
  songs_breakdown?: MediaProjectSong[];
  /** Optional cover art name (relevant when the offering has cover art). */
  cover_art_name?: string | null;
  /** Optional songs the shorts will use (relevant when offering has shorts). */
  shorts_song_targets?: string | null;
  /** Optional vibe / mood description. */
  vibe?: string | null;
  /** Optional reference links / artist names. */
  references?: string | null;
  /** Optional ISO date for target release. */
  release_date?: string | null;
  /** Optional catch-all. */
  notes?: string | null;
}

// ============================================================
// Cart item — one row in the buyer's cart
// ============================================================

/**
 * One offering in the buyer's cart. The `id` is a client-generated
 * (crypto.randomUUID) identifier so we can have MULTIPLE entries for
 * the SAME offering (e.g., two short videos for two different songs)
 * without collisions. The server doesn't trust this id — it just lets
 * the UI key React lists.
 */
export interface MediaCartItem {
  /** Client-side UUID. Used for React keys + cart removal. */
  id: string;
  /** Full offering snapshot at time of add — read-only from cart's perspective. */
  offering: MediaOffering;
  /**
   * Set when the offering is configurable (packages with slots). Captured
   * at add-to-cart time; the user must re-add if they want to change.
   * Empty for non-configurable offerings.
   */
  configuredComponents?: ConfiguredComponents;
  projectDetails: MediaProjectDetails;
  /**
   * Computed price at add-to-cart time, for display in the cart summary.
   * The server recomputes this independently before charging — never
   * trust the client price.
   */
  computedPriceCents: number;
}

// ============================================================
// Cart payload — what the client POSTs to checkout
// ============================================================

/**
 * The shape /api/media/checkout accepts. We strip the heavy `offering`
 * snapshot and re-fetch on the server (the offering may have been
 * edited since the buyer added it; we want fresh canonical data).
 */
export interface MediaCheckoutCartItem {
  /** Client-side cart-item id, only used for echoing back in errors. */
  id: string;
  slug: string;
  configured_components?: ConfiguredComponents;
  project_details: MediaProjectDetails;
}

export function toCheckoutPayload(items: MediaCartItem[]): MediaCheckoutCartItem[] {
  return items.map((it) => ({
    id: it.id,
    slug: it.offering.slug,
    configured_components: it.configuredComponents,
    project_details: it.projectDetails,
  }));
}

// ============================================================
// Validation helpers
// ============================================================

/**
 * Round 6: project details are entirely optional. This helper still
 * exists for symmetry with future stricter offerings (e.g. an offering
 * that wants a target release date set) — for now it always returns
 * true. The cart's checkout button validates phone-presence separately.
 */
export function isProjectDetailsComplete(_d: MediaProjectDetails): boolean {
  return true;
}

export const EMPTY_PROJECT_DETAILS: MediaProjectDetails = {
  project_name: '',
  songs: '',
  songs_breakdown: [],
  cover_art_name: '',
  shorts_song_targets: '',
  vibe: '',
  references: '',
  release_date: '',
  notes: '',
};
