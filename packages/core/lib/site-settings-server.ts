// lib/site-settings-server.ts — server loader for the white-label feature/nav
// flags. DI'd form (loadSiteSettings(db)) for API routes/scripts, plus a
// React cache()-wrapped getSiteSettings() so the Header + Footer + page share a
// single query per render. Fail-open: any error / missing row → all features ON.

import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import {
  siteSettingsFromRow, DEFAULT_SITE_SETTINGS, isHrefEnabled, type SiteSettings,
} from '@/lib/site-settings';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/** DI'd loader (API routes / scripts). Fail-open to all-on defaults. */
export async function loadSiteSettings(db: Client): Promise<SiteSettings> {
  try {
    const { data } = await db.from('site_settings').select('*').is('studio_id', null).maybeSingle();
    return siteSettingsFromRow(data as Record<string, unknown> | null);
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}

/** Per-request memoized convenience for RSCs / layout slots / page guards.
 *  React cache() dedupes the many reads within ONE render into a single query. */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  return loadSiteSettings(createServiceClient());
});

/** Page guard: 404 a route whose feature/page is turned off. Locked routes
 *  (/book, /pricing, /beats, /sell-beats) are always enabled, so calling this
 *  for them is a safe no-op. Call at the top of a server component:
 *    await requireHref('/bands');
 */
export async function requireHref(href: string): Promise<void> {
  const s = await getSiteSettings();
  if (!isHrefEnabled(href, s)) notFound();
}

/** Ensure the singleton default row exists (lazy, idempotent). The migration
 *  already seeds it; this is a belt-and-suspenders for the write path. */
export async function ensureSiteSettingsRow(db: Client): Promise<void> {
  const { data } = await db.from('site_settings').select('id').is('studio_id', null).maybeSingle();
  if (!data) await db.from('site_settings').insert({ studio_id: null } as any);
}
