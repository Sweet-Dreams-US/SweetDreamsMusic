// lib/site-content-server.ts — load + seed CMS content. getSiteContent() is
// React cache()-wrapped (one query per render shared by Footer + page) and merges
// DB overrides onto the registry defaults, so a missing/half-populated table can
// never blank a page. Values are stored as { v: payload } in site_content.value.

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { CONTENT_REGISTRY, REGISTRY_BY_KEY, type ContentMap } from '@/lib/site-content';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;
const DEFAULT_LOCATION_SLUG = 'sweet-dreams';

function defaultsMap(): ContentMap {
  const m: ContentMap = {};
  for (const f of CONTENT_REGISTRY) m[f.key] = f.default;
  return m;
}

/** All CMS content, registry defaults overlaid with DB values. cache()'d per request. */
export const getSiteContent = cache(async (): Promise<ContentMap> => {
  const map = defaultsMap();
  try {
    const db = createServiceClient();
    const { data } = await db.from('site_content').select('key, value');
    for (const r of (data ?? []) as any[]) {
      const v = r.value?.v;
      if (v !== undefined && r.key in REGISTRY_BY_KEY) map[r.key] = v;
    }
  } catch {
    /* fall back to registry defaults */
  }
  return map;
});

/** Bust the public shell so edits appear on next request. */
export function revalidateSiteContent() {
  revalidatePath('/', 'layout');
}

/**
 * Seed site_content from the registry (idempotent). Default mode SKIPS keys that
 * already exist so it never clobbers an admin's edits; overwrite:true resets.
 */
export async function seedSiteContentFromRegistry(db: Client, opts?: { overwrite?: boolean }): Promise<{ upserted: number; skipped: number }> {
  const { data: loc } = await db.from('studios').select('id').eq('slug', DEFAULT_LOCATION_SLUG).maybeSingle();
  const locationId = (loc as any)?.id ?? null;
  let upserted = 0, skipped = 0;
  for (const f of CONTENT_REGISTRY) {
    if (!opts?.overwrite) {
      const { data: existing } = await db.from('site_content').select('key').eq('key', f.key).maybeSingle();
      if (existing) { skipped++; continue; }
    }
    await db.from('site_content').upsert({
      key: f.key, value: { v: f.default }, group_name: f.group, label: f.label, kind: f.kind,
      location_id: locationId, updated_by: 'seed',
    } as any, { onConflict: 'key' });
    upserted++;
  }
  return { upserted, skipped };
}
