// lib/revenue-config-server.ts — load the DB revenue-share config + per-person
// overrides, and seed the defaults from constants. Fail-open to constants so
// payroll can never break. Percents in the DB (0..100) → fractions (0..1).

// Client-injected (takes a db param, no next/headers), so it's importable from
// routes AND tsx scripts — same convention as lib/studio-config-server.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { revenueConfigFromConstants, normalizeName, type RevenueConfig, type Overrides } from '@/lib/earnings-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/** Studio default splits (payroll-relevant subset) from revenue_settings.
 *  Missing row / error → constants (byte-identical to today). */
export async function getRevenueConfig(db: Client, studioId: string | null = null): Promise<RevenueConfig> {
  void studioId; // single-tenant today; always the NULL (default) row
  try {
    const { data } = await db.from('revenue_settings').select('*').is('studio_id', null).maybeSingle();
    if (!data) return revenueConfigFromConstants();
    const engineerSessionSplit = Number((data as any).engineer_session_pct) / 100;
    const bandPct = (data as any).engineer_band_session_pct;
    return {
      engineerSessionSplit,
      // NULL band pct → inherit the solo split (so unset = no band premium).
      engineerBandSessionSplit: bandPct != null ? Number(bandPct) / 100 : engineerSessionSplit,
      producerCommission: Number((data as any).producer_commission_pct) / 100,
      mediaSellerPct: Number((data as any).media_seller_pct) / 100,
      mediaWorkerTotal: Number((data as any).media_worker_pct) / 100,
    };
  } catch {
    return revenueConfigFromConstants();
  }
}

/** The FULL revenue_settings row (all 6 fields as percents) for the admin editor. */
export async function getRevenueSettingsRow(db: Client): Promise<Record<string, number>> {
  const c = revenueConfigFromConstants();
  const fallback = {
    engineer_session_pct: c.engineerSessionSplit * 100,
    engineer_band_session_pct: c.engineerBandSessionSplit * 100,
    producer_commission_pct: c.producerCommission * 100,
    media_seller_pct: c.mediaSellerPct * 100,
    media_worker_pct: c.mediaWorkerTotal * 100,
    media_business_pct: 100 - c.mediaSellerPct * 100 - c.mediaWorkerTotal * 100,
    renewal_discount_pct: 75,
  };
  try {
    const { data } = await db.from('revenue_settings').select('*').is('studio_id', null).maybeSingle();
    if (!data) return fallback;
    const bandPct = (data as any).engineer_band_session_pct;
    return {
      engineer_session_pct: Number((data as any).engineer_session_pct),
      engineer_band_session_pct: bandPct != null ? Number(bandPct) : Number((data as any).engineer_session_pct),
      producer_commission_pct: Number((data as any).producer_commission_pct),
      media_seller_pct: Number((data as any).media_seller_pct),
      media_worker_pct: Number((data as any).media_worker_pct),
      media_business_pct: Number((data as any).media_business_pct),
      renewal_discount_pct: Number((data as any).renewal_discount_pct),
    };
  } catch {
    return fallback;
  }
}

/** Per-person overrides keyed by canonical (normalized) name. NULL columns are
 *  excluded by the query, so the maps contain only real overrides. */
export async function getRevenueOverrides(db: Client): Promise<Overrides> {
  const engineerByName: Record<string, number | null> = {};
  const engineerBandByName: Record<string, number | null> = {};
  const producerByName: Record<string, number | null> = {};
  try {
    const [{ data: engs }, { data: prods }] = await Promise.all([
      db.from('engineers').select('name, session_split_pct, band_session_split_pct'),
      db.from('profiles').select('producer_name, producer_commission_pct').not('producer_commission_pct', 'is', null).not('producer_name', 'is', null),
    ]);
    for (const e of (engs ?? []) as any[]) {
      const n = normalizeName(e.name); if (!n) continue;
      if (e.session_split_pct != null) engineerByName[n] = Number(e.session_split_pct);
      if (e.band_session_split_pct != null) engineerBandByName[n] = Number(e.band_session_split_pct);
    }
    for (const p of (prods ?? []) as any[]) { const n = normalizeName(p.producer_name); if (n) producerByName[n] = Number(p.producer_commission_pct); }
  } catch {
    /* no overrides on error */
  }
  return { engineerByName, engineerBandByName, producerByName };
}

/** Seed/reset the default revenue_settings row to the current constants (idempotent). */
export async function seedRevenueFromConstants(db: Client): Promise<void> {
  const c = revenueConfigFromConstants();
  const updates = {
    engineer_session_pct: c.engineerSessionSplit * 100,
    engineer_band_session_pct: c.engineerBandSessionSplit * 100,
    producer_commission_pct: c.producerCommission * 100,
    media_seller_pct: c.mediaSellerPct * 100,
    media_worker_pct: c.mediaWorkerTotal * 100,
    media_business_pct: 100 - c.mediaSellerPct * 100 - c.mediaWorkerTotal * 100,
    renewal_discount_pct: 75,
  };
  const { data: existing } = await db.from('revenue_settings').select('id').is('studio_id', null).maybeSingle();
  if (existing) await db.from('revenue_settings').update(updates as never).is('studio_id', null);
  else await db.from('revenue_settings').insert({ studio_id: null, ...updates } as never);
}
