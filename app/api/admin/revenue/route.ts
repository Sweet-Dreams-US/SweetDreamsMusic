import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getRevenueSettingsRow } from '@/lib/revenue-config-server';

// Admin editor for revenue_settings (per-tenant default splits) + per-person
// overrides (engineers.session_split_pct, profiles.producer_commission_pct).
// Historical payroll is frozen by per-transaction snapshots, so edits here only
// move FUTURE / un-snapshotted rows.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

const SETTINGS_FIELDS = new Set([
  'engineer_session_pct', 'producer_commission_pct',
  'media_seller_pct', 'media_worker_pct', 'media_business_pct', 'renewal_discount_pct',
]);

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const db = createServiceClient();
  const [settings, { data: engineers }, { data: producers }] = await Promise.all([
    getRevenueSettingsRow(db),
    db.from('engineers').select('id, name, display_name, email, session_split_pct, active').order('sort_order'),
    db.from('profiles').select('user_id, producer_name, producer_commission_pct').not('producer_name', 'is', null).order('producer_name'),
  ]);
  return NextResponse.json({ settings, engineers: engineers ?? [], producers: producers ?? [] });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const db = createServiceClient();

  if (body.kind === 'settings') {
    const updates: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.updates ?? {})) {
      if (SETTINGS_FIELDS.has(k)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) return NextResponse.json({ error: `Invalid ${k}` }, { status: 400 });
        updates[k] = n;
      }
    }
    if (!Object.keys(updates).length) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    // Server-side media-sum guard (mirrors the DB CHECK) for a friendly error.
    const row = await getRevenueSettingsRow(db);
    const merged = { ...row, ...updates };
    if (Math.round(merged.media_seller_pct + merged.media_worker_pct + merged.media_business_pct) !== 100) {
      return NextResponse.json({ error: 'Media seller + worker + business must total 100%.' }, { status: 400 });
    }
    const { error } = await db.from('revenue_settings').update(updates as never).is('studio_id', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.kind === 'engineer') {
    const { id, pct } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const val = pct == null || pct === '' ? null : Number(pct);
    if (val != null && (!Number.isFinite(val) || val < 0 || val > 100)) return NextResponse.json({ error: 'Invalid pct' }, { status: 400 });
    const { error } = await db.from('engineers').update({ session_split_pct: val } as never).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.kind === 'producer') {
    const { userId, pct } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    const val = pct == null || pct === '' ? null : Number(pct);
    if (val != null && (!Number.isFinite(val) || val < 0 || val > 100)) return NextResponse.json({ error: 'Invalid pct' }, { status: 400 });
    const { error } = await db.from('profiles').update({ producer_commission_pct: val } as never).eq('user_id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  }

  revalidatePath('/', 'layout'); // refresh anything reading renewal % on public pages
  return NextResponse.json({ success: true });
}
