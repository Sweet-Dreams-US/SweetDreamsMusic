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
