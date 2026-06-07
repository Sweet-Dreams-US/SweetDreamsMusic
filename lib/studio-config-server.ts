// lib/studio-config-server.ts — load StudioConfig from the DB + seed it from the
// current constants. Client-injected (no next/headers) so routes + scripts use it.
// getStudioConfig falls back to the constants if a room row is missing, so a
// half-migrated state can never break booking.
//
// Tables: studio_rooms (bookable rooms) belong to a studios row (the tenant/location,
// slug 'sweet-dreams'). Pricing/surcharges/engineers hang off studio_rooms.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROOMS, ENGINEERS, type Room } from '@/lib/constants';
import { studioConfigFromConstants, type StudioConfig, type StudioTier } from '@/lib/studio-config';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

const DEFAULT_LOCATION_SLUG = 'sweet-dreams';

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

/** Load one room's full pricing/hours config. Falls back to the constants when the
 *  room isn't in the DB yet (pre-migration / safety) so pricing never breaks. */
export async function getStudioConfig(db: Client, slug: string): Promise<StudioConfig> {
  const { data: s } = await db.from('studio_rooms').select('*').eq('slug', slug).eq('active', true).maybeSingle();
  if (!s) {
    if ((ROOMS as readonly string[]).includes(slug)) return studioConfigFromConstants(slug as Room);
    throw new Error(`Unknown studio room: ${slug}`);
  }
  const [{ data: tiers }, { data: surcharges }] = await Promise.all([
    db.from('studio_room_pricing_tiers').select('*').eq('room_id', (s as any).id).eq('active', true),
    db.from('studio_room_surcharges').select('*').or(`room_id.eq.${(s as any).id},room_id.is.null`).eq('active', true),
  ]);
  return rowToConfig(s, tiers ?? [], surcharges ?? []);
}

/**
 * Load FULL configs for every active room in one shot (booking flow, pricing
 * page). Falls back to the constants when no rooms exist yet, so the UI never
 * renders empty during a half-migration.
 */
export async function getStudioConfigs(db: Client): Promise<StudioConfig[]> {
  const { data: rooms } = await db.from('studio_rooms').select('*').eq('active', true).order('sort_order');
  if (!rooms || rooms.length === 0) return (ROOMS as readonly Room[]).map((r) => studioConfigFromConstants(r));
  const ids = rooms.map((r: any) => r.id);
  const [{ data: tiers }, { data: surcharges }] = await Promise.all([
    db.from('studio_room_pricing_tiers').select('*').in('room_id', ids).eq('active', true),
    db.from('studio_room_surcharges').select('*').eq('active', true), // global (room_id NULL) + per-room
  ]);
  return rooms.map((r: any) =>
    rowToConfig(
      r,
      (tiers ?? []).filter((t: any) => t.room_id === r.id),
      (surcharges ?? []).filter((c: any) => c.room_id === r.id || c.room_id == null),
    ),
  );
}

/** Active bookable rooms for pickers + public display. */
export async function getStudios(db: Client): Promise<Array<{ slug: string; displayName: string; hourlyRateCents: number; singleHourRateCents: number; bandEnabled: boolean; sortOrder: number }>> {
  const { data } = await db.from('studio_rooms').select('slug,display_name,hourly_rate_cents,single_hour_rate_cents,band_enabled,sort_order').eq('active', true).order('sort_order');
  return (data ?? []).map((s: any) => ({ slug: s.slug, displayName: s.display_name, hourlyRateCents: s.hourly_rate_cents, singleHourRateCents: s.single_hour_rate_cents, bandEnabled: s.band_enabled, sortOrder: s.sort_order }));
}

/**
 * Seed studio_rooms / tiers / surcharges / engineers / assignments from the current
 * constants, under the default tenant (slug 'sweet-dreams'). Day-one identical to
 * today (golden + parity proven). Idempotent.
 */
export async function seedStudiosFromConstants(db: Client): Promise<{ locationId: string | null; rooms: number; tiers: number; surcharges: number; engineers: number }> {
  let nRooms = 0, nTiers = 0, nSurcharges = 0, nEngineers = 0;

  const { data: loc } = await db.from('studios').select('id').eq('slug', DEFAULT_LOCATION_SLUG).maybeSingle();
  const locationId = (loc as any)?.id ?? null;

  // Global surcharges (same for every room today) — room_id NULL = applies to all.
  const baseCfg = studioConfigFromConstants('studio_a');
  for (const s of baseCfg.surcharges) {
    await db.from('studio_room_surcharges').upsert(
      { room_id: null, kind: s.kind, start_hour: s.startHour, end_hour: s.endHour, amount_cents: s.amountCents, active: true } as any,
      { onConflict: 'room_id,kind' },
    );
    nSurcharges++;
  }

  const roomIdBySlug = new Map<string, string>();
  let sort = 0;
  for (const room of ROOMS as readonly Room[]) {
    const c = studioConfigFromConstants(room);
    const { data: srow } = await db.from('studio_rooms').upsert({
      location_id: locationId, slug: c.slug, display_name: c.displayName,
      hourly_rate_cents: c.hourlyRateCents, single_hour_rate_cents: c.singleHourRateCents,
      deposit_percent: c.depositPercent, min_hours: c.minHours, max_hours: c.maxHours,
      free_guests: c.freeGuests, guest_fee_cents: c.guestFeeCents, max_guests: c.maxGuests,
      weekday_start_hour: c.weekdayStartHour, open_hour: c.openHour, close_hour: c.closeHour,
      same_day_buffer_hours: c.sameDayBufferHours, band_enabled: c.bandEnabled,
      sort_order: sort++, active: true,
    } as any, { onConflict: 'slug' }).select('id').single();
    if (srow) { roomIdBySlug.set(c.slug, (srow as any).id); nRooms++; }
    const roomId = roomIdBySlug.get(c.slug)!;
    for (const t of c.tiers as StudioTier[]) {
      await db.from('studio_room_pricing_tiers').upsert(
        { room_id: roomId, kind: t.kind, hours: t.hours, price_cents: t.priceCents, per_hour_cents: t.perHourCents, label: t.label ?? null, note: t.note ?? null, active: true } as any,
        { onConflict: 'room_id,kind' },
      );
      nTiers++;
    }
  }

  // Engineers + room assignments (email = stable identity).
  for (const e of ENGINEERS) {
    const { data: erow } = await db.from('engineers').upsert(
      { location_id: locationId, email: e.email.toLowerCase(), name: e.name, display_name: e.displayName, specialties: e.specialties as unknown as string[], active: true } as any,
      { onConflict: 'email' },
    ).select('id').single();
    if (!erow) continue;
    nEngineers++;
    for (const roomSlug of e.studios as readonly string[]) {
      const rid = roomIdBySlug.get(roomSlug);
      if (rid) await db.from('studio_room_engineers').upsert({ room_id: rid, engineer_id: (erow as any).id } as any, { onConflict: 'room_id,engineer_id' });
    }
  }

  return { locationId, rooms: nRooms, tiers: nTiers, surcharges: nSurcharges, engineers: nEngineers };
}
