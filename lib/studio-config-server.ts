// lib/studio-config-server.ts — load StudioConfig from the DB + seed it from the
// current constants. Client-injected (no next/headers) so routes + scripts use it.
// getStudioConfig falls back to the constants if a studio row is missing, so a
// half-migrated state can never break booking.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROOMS, ENGINEERS, type Room } from '@/lib/constants';
import { studioConfigFromConstants, type StudioConfig, type StudioTier, type StudioSurcharge } from '@/lib/studio-config';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/** Map a studios row (+ its tiers + applicable surcharges) to a StudioConfig. */
function rowToConfig(s: any, tiers: any[], surcharges: any[]): StudioConfig {
  return {
    slug: s.slug,
    displayName: s.display_name,
    hourlyRateCents: s.hourly_rate_cents,
    singleHourRateCents: s.single_hour_rate_cents,
    depositPercent: s.deposit_percent,
    minHours: Number(s.min_hours),
    maxHours: Number(s.max_hours),
    freeGuests: s.free_guests,
    guestFeeCents: s.guest_fee_cents,
    maxGuests: s.max_guests,
    weekdayStartHour: s.weekday_start_hour == null ? null : Number(s.weekday_start_hour),
    openHour: Number(s.open_hour),
    closeHour: Number(s.close_hour),
    sameDayBufferHours: s.same_day_buffer_hours,
    bandEnabled: s.band_enabled,
    tiers: tiers.map((t) => ({ kind: t.kind, hours: Number(t.hours), priceCents: t.price_cents, perHourCents: t.per_hour_cents, label: t.label, note: t.note })),
    surcharges: surcharges.map((c) => ({ kind: c.kind, startHour: c.start_hour == null ? null : Number(c.start_hour), endHour: c.end_hour == null ? null : Number(c.end_hour), amountCents: c.amount_cents })),
  };
}

/**
 * Load one studio's full pricing/hours config. Falls back to the constants when the
 * studio isn't in the DB yet (pre-migration / safety) so pricing never breaks.
 */
export async function getStudioConfig(db: Client, slug: string): Promise<StudioConfig> {
  const { data: s } = await db.from('studios').select('*').eq('slug', slug).eq('active', true).maybeSingle();
  if (!s) {
    // Fallback: known constants room, else throw (unknown studio).
    if ((ROOMS as readonly string[]).includes(slug)) return studioConfigFromConstants(slug as Room);
    throw new Error(`Unknown studio: ${slug}`);
  }
  const [{ data: tiers }, { data: surcharges }] = await Promise.all([
    db.from('studio_pricing_tiers').select('*').eq('studio_id', (s as any).id).eq('active', true),
    db.from('studio_surcharges').select('*').or(`studio_id.eq.${(s as any).id},studio_id.is.null`).eq('active', true),
  ]);
  return rowToConfig(s, tiers ?? [], surcharges ?? []);
}

/** Active studios for pickers + public display (lightweight). */
export async function getStudios(db: Client): Promise<Array<{ slug: string; displayName: string; hourlyRateCents: number; singleHourRateCents: number; bandEnabled: boolean; sortOrder: number }>> {
  const { data } = await db.from('studios').select('slug,display_name,hourly_rate_cents,single_hour_rate_cents,band_enabled,sort_order').eq('active', true).order('sort_order');
  return (data ?? []).map((s: any) => ({ slug: s.slug, displayName: s.display_name, hourlyRateCents: s.hourly_rate_cents, singleHourRateCents: s.single_hour_rate_cents, bandEnabled: s.band_enabled, sortOrder: s.sort_order }));
}

/**
 * Seed studios / tiers / surcharges / engineers / assignments from the current
 * constants — day-one identical to today (golden + parity proven). Idempotent.
 */
export async function seedStudiosFromConstants(db: Client): Promise<{ studios: number; tiers: number; surcharges: number; engineers: number }> {
  let nStudios = 0, nTiers = 0, nSurcharges = 0, nEngineers = 0;

  // Global surcharges (same for every studio today) — studio_id NULL = applies to all.
  const baseCfg = studioConfigFromConstants('studio_a');
  for (const s of baseCfg.surcharges) {
    await db.from('studio_surcharges').upsert(
      { studio_id: null, kind: s.kind, start_hour: s.startHour, end_hour: s.endHour, amount_cents: s.amountCents, active: true } as any,
      { onConflict: 'studio_id,kind' }, // NULLS NOT DISTINCT → idempotent for global rows
    );
    nSurcharges++;
  }

  const studioIdBySlug = new Map<string, string>();
  let sort = 0;
  for (const room of ROOMS as readonly Room[]) {
    const c = studioConfigFromConstants(room);
    const { data: srow } = await db.from('studios').upsert({
      slug: c.slug, display_name: c.displayName,
      hourly_rate_cents: c.hourlyRateCents, single_hour_rate_cents: c.singleHourRateCents,
      deposit_percent: c.depositPercent, min_hours: c.minHours, max_hours: c.maxHours,
      free_guests: c.freeGuests, guest_fee_cents: c.guestFeeCents, max_guests: c.maxGuests,
      weekday_start_hour: c.weekdayStartHour, open_hour: c.openHour, close_hour: c.closeHour,
      same_day_buffer_hours: c.sameDayBufferHours, band_enabled: c.bandEnabled,
      sort_order: sort++, active: true,
    } as any, { onConflict: 'slug' }).select('id').single();
    if (srow) { studioIdBySlug.set(c.slug, (srow as any).id); nStudios++; }
    const studioId = studioIdBySlug.get(c.slug)!;
    for (const t of c.tiers as StudioTier[]) {
      await db.from('studio_pricing_tiers').upsert(
        { studio_id: studioId, kind: t.kind, hours: t.hours, price_cents: t.priceCents, per_hour_cents: t.perHourCents, label: t.label ?? null, note: t.note ?? null, active: true } as any,
        { onConflict: 'studio_id,kind' },
      );
      nTiers++;
    }
  }

  // Engineers + studio assignments (email = stable identity).
  for (const e of ENGINEERS) {
    const { data: erow } = await db.from('engineers').upsert(
      { email: e.email.toLowerCase(), name: e.name, display_name: e.displayName, specialties: e.specialties as unknown as string[], active: true } as any,
      { onConflict: 'email' },
    ).select('id').single();
    if (!erow) continue;
    nEngineers++;
    for (const roomSlug of e.studios as readonly string[]) {
      const sid = studioIdBySlug.get(roomSlug);
      if (sid) await db.from('studio_engineers').upsert({ studio_id: sid, engineer_id: (erow as any).id } as any, { onConflict: 'studio_id,engineer_id' });
    }
  }

  return { studios: nStudios, tiers: nTiers, surcharges: nSurcharges, engineers: nEngineers };
}
