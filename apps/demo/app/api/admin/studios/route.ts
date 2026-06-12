import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

// Admin editor for studio_rooms + pricing tiers + surcharges + engineer
// assignments. The booking engine already reads these (getStudioConfig), and all
// public pages are dynamic, so edits cascade to /pricing, /book, and the charge
// immediately. revalidatePath busts any cached layout output as a safety net.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

// Allow-listed editable columns per entity (prevents writing slug/id/location_id etc.).
const ROOM_FIELDS = new Set([
  'display_name', 'hourly_rate_cents', 'single_hour_rate_cents', 'deposit_percent',
  'min_hours', 'max_hours', 'free_guests', 'guest_fee_cents', 'max_guests',
  'weekday_start_hour', 'open_hour', 'close_hour', 'same_day_buffer_hours',
  'band_enabled', 'sort_order', 'active',
]);
const TIER_FIELDS = new Set(['price_cents', 'per_hour_cents', 'label', 'note', 'hours', 'active']);
const SURCHARGE_FIELDS = new Set(['amount_cents', 'start_hour', 'end_hour', 'active']);

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const db = createServiceClient();

  const [{ data: rooms }, { data: tiers }, { data: surcharges }, { data: roster }, { data: assigns }] =
    await Promise.all([
      db.from('studio_rooms').select('*').order('sort_order'),
      db.from('studio_room_pricing_tiers').select('*'),
      db.from('studio_room_surcharges').select('*'),
      db.from('engineers').select('id, display_name, name, email, active').order('sort_order'),
      db.from('studio_room_engineers').select('room_id, engineer_id'),
    ]);

  const byRoom = (rid: string) => ({
    tiers: (tiers ?? []).filter((t: any) => t.room_id === rid),
    surcharges: (surcharges ?? []).filter((c: any) => c.room_id === rid),
    engineerIds: (assigns ?? []).filter((a: any) => a.room_id === rid).map((a: any) => a.engineer_id),
  });

  return NextResponse.json({
    rooms: (rooms ?? []).map((r: any) => ({ ...r, ...byRoom(r.id) })),
    globalSurcharges: (surcharges ?? []).filter((c: any) => c.room_id == null),
    roster: roster ?? [],
  });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const db = createServiceClient();
  const { kind } = body;

  if (kind === 'room') {
    const { id, updates } = body;
    if (!id || !updates) return NextResponse.json({ error: 'id + updates required' }, { status: 400 });
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) if (ROOM_FIELDS.has(k)) clean[k] = v;
    if (!Object.keys(clean).length) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    const { error } = await db.from('studio_rooms').update(clean as never).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (kind === 'tier') {
    const { id, updates } = body;
    if (!id || !updates) return NextResponse.json({ error: 'id + updates required' }, { status: 400 });
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) if (TIER_FIELDS.has(k)) clean[k] = v;
    const { error } = await db.from('studio_room_pricing_tiers').update(clean as never).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (kind === 'surcharge') {
    const { id, updates } = body;
    if (!id || !updates) return NextResponse.json({ error: 'id + updates required' }, { status: 400 });
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) if (SURCHARGE_FIELDS.has(k)) clean[k] = v;
    const { error } = await db.from('studio_room_surcharges').update(clean as never).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (kind === 'assign' || kind === 'unassign') {
    const { roomId, engineerId } = body;
    if (!roomId || !engineerId) return NextResponse.json({ error: 'roomId + engineerId required' }, { status: 400 });
    if (kind === 'assign') {
      const { error } = await db.from('studio_room_engineers').upsert({ room_id: roomId, engineer_id: engineerId } as never, { onConflict: 'room_id,engineer_id' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await db.from('studio_room_engineers').delete().eq('room_id', roomId).eq('engineer_id', engineerId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  }

  revalidatePath('/', 'layout');
  return NextResponse.json({ success: true });
}
