// GET/PATCH /api/admin/tax/profile — the singleton business tax profile.
// Admin only. Mirrors the brand-settings allow-list pattern.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getTaxProfile } from '@/lib/tax-server';
import { ENTITY_TYPES } from '@/lib/tax';

const EDITABLE = new Set(['entity_type', 'ein_last4', 'state', 'fiscal_year_start_month', 'estimated_income_tax_rate', 'notes']);
const ENTITY_VALUES = ENTITY_TYPES.map((e) => e.value);

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const g = await requireAdmin();
  if (g.error) return g.error;
  return NextResponse.json({ profile: await getTaxProfile(createServiceClient()) });
}

export async function PATCH(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!EDITABLE.has(k)) continue;
    if (k === 'entity_type' && !ENTITY_VALUES.includes(v as never)) {
      return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }
    if (k === 'ein_last4') { updates[k] = v ? String(v).replace(/\D/g, '').slice(-4) : null; continue; }
    if (k === 'estimated_income_tax_rate') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) return NextResponse.json({ error: 'Rate must be 0–100' }, { status: 400 });
      updates[k] = n; continue;
    }
    if (k === 'fiscal_year_start_month') {
      const n = Math.round(Number(v));
      if (!(n >= 1 && n <= 12)) return NextResponse.json({ error: 'Month must be 1–12' }, { status: 400 });
      updates[k] = n; continue;
    }
    updates[k] = v === '' ? null : v;
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });

  const db = createServiceClient();
  const { error } = await db.from('business_tax_profiles').update(updates as never).is('studio_id', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, profile: await getTaxProfile(db) });
}
