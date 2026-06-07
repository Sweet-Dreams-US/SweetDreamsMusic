// lib/brand-server.ts — load brand identity from brand_settings. cache()'d so the
// layout metadata + Header + Footer + JsonLd share one query per render. Fail-open
// to the BRAND constant.

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { brandFromConstants, brandFromRow, type Brand } from '@/lib/brand';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const db = createServiceClient();
    const { data } = await db.from('brand_settings').select('*').is('studio_id', null).maybeSingle();
    return brandFromRow(data);
  } catch {
    return brandFromConstants();
  }
});

/** Raw row for the admin editor (all columns). */
export async function getBrandRow(db: Client): Promise<Record<string, string>> {
  const k = brandFromConstants();
  const fallback = {
    name: k.name, legal_name: k.legalName, tagline: k.tagline, phone: k.phone, email: k.email,
    addr_street: k.address.street, addr_city: k.address.city, addr_state: k.address.state, addr_zip: k.address.zip, addr_country: k.address.country,
  };
  try {
    const { data } = await db.from('brand_settings').select('*').is('studio_id', null).maybeSingle();
    if (!data) return fallback;
    return {
      name: (data as any).name, legal_name: (data as any).legal_name, tagline: (data as any).tagline,
      phone: (data as any).phone, email: (data as any).email,
      addr_street: (data as any).addr_street, addr_city: (data as any).addr_city, addr_state: (data as any).addr_state,
      addr_zip: (data as any).addr_zip, addr_country: (data as any).addr_country,
    };
  } catch {
    return fallback;
  }
}

export function revalidateBrand() {
  revalidatePath('/', 'layout');
}
