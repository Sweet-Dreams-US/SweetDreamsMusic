// lib/brand.ts — brand identity type + constant fallback (pure, client-safe).
// The DB (brand_settings) overrides this; the constant is the safe fallback so a
// missing row never breaks rendering or SEO.

import { BRAND } from '@/lib/constants';

export interface Brand {
  name: string;
  legalName: string;
  tagline: string;
  phone: string;
  email: string;
  address: { street: string; city: string; state: string; zip: string; country: string };
  /** Official social URLs (instagram/youtube/tiktok/…) — feeds JSON-LD sameAs. */
  socials: Record<string, string>;
  /** Outbound email identity (Resend FROM). */
  fromEmail: string;
  fromName: string;
  /** Beat-store sub-brand ("Sweet Dreams Beat Store") — NOT derivable from name. */
  storeName: string;
  /** Media-division sub-brand ("Sweet Dreams Media") — NOT derivable from name. */
  mediaName: string;
  /** Google Analytics measurement id — empty string = no analytics tag. */
  gaId: string;
  /** Public review CTA target (Google review link) — empty string = no review ask. */
  reviewUrl: string;
  /** Physical coordinates for JSON-LD geo. */
  geo: { lat: number; lng: number };
}

// Whitelabel W0: the constant fallback carries the SAME values the DB row is
// seeded with (086) — output stays byte-identical whether the row loads or not.
const FALLBACK_SOCIALS: Record<string, string> = {
  instagram: 'https://www.instagram.com/sweetdreamsmusic',
  youtube: 'https://www.youtube.com/@sweetdreamsmusic',
  tiktok: 'https://www.tiktok.com/@sweetdreamsmusic',
};

export function brandFromConstants(): Brand {
  return {
    name: BRAND.name,
    legalName: BRAND.legalName,
    tagline: BRAND.tagline,
    phone: BRAND.phone,
    email: BRAND.email,
    address: { ...BRAND.address },
    socials: { ...FALLBACK_SOCIALS },
    fromEmail: 'studio@sweetdreamsmusic.com',
    fromName: BRAND.name,
    storeName: 'Sweet Dreams Beat Store',
    mediaName: 'Sweet Dreams Media',
    gaId: '', // analytics comes from the DB row only — no cross-studio fallback
    reviewUrl: 'https://g.page/r/CcWAY0XlIQNpEBM/review',
    geo: { lat: 41.0793, lng: -85.1394 },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function brandFromRow(row: any): Brand {
  if (!row) return brandFromConstants();
  const k = brandFromConstants();
  return {
    name: row.name ?? k.name,
    legalName: row.legal_name ?? k.legalName,
    tagline: row.tagline ?? k.tagline,
    phone: row.phone ?? k.phone,
    email: row.email ?? k.email,
    address: {
      street: row.addr_street ?? k.address.street,
      city: row.addr_city ?? k.address.city,
      state: row.addr_state ?? k.address.state,
      zip: row.addr_zip ?? k.address.zip,
      country: row.addr_country ?? k.address.country,
    },
    socials: row.socials && Object.keys(row.socials).length > 0 ? row.socials : k.socials,
    fromEmail: row.from_email || k.fromEmail,
    fromName: row.from_name || k.fromName,
    storeName: row.store_name || k.storeName,
    mediaName: row.media_name || k.mediaName,
    gaId: row.ga_id || k.gaId,
    // ?? not ||: an EXPLICIT '' means "no review ask" (the email omits the
    // review block) — '' must not coalesce to Sweet Dreams' review link.
    reviewUrl: row.review_url ?? k.reviewUrl,
    geo: {
      lat: row.geo_lat != null ? Number(row.geo_lat) : k.geo.lat,
      lng: row.geo_lng != null ? Number(row.geo_lng) : k.geo.lng,
    },
  };
}

/** Full state names for SEO copy ("Fort Wayne, Indiana"). Extend as studios onboard in new states. */
export const STATE_NAMES: Record<string, string> = { IN: 'Indiana' };
/** "Indiana" — full state name for prose; falls back to the raw code when unmapped. */
export const stateName = (b: Brand) => STATE_NAMES[b.address.state] ?? b.address.state;
/** "US-IN" — geo region code for meta tags, derived (never stored). */
export const geoRegion = (b: Brand) => `${b.address.country}-${b.address.state}`;
/** Social URLs as a clean array for JSON-LD sameAs. */
export const socialLinks = (b: Brand) => Object.values(b.socials).filter(Boolean);
/** "Fort Wayne, IN" */
export const cityState = (b: Brand) => `${b.address.city}, ${b.address.state}`;
