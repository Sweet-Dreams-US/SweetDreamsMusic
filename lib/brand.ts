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
}

export function brandFromConstants(): Brand {
  return {
    name: BRAND.name,
    legalName: BRAND.legalName,
    tagline: BRAND.tagline,
    phone: BRAND.phone,
    email: BRAND.email,
    address: { ...BRAND.address },
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
  };
}
