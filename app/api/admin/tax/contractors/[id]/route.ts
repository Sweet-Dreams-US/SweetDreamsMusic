// PATCH /api/admin/tax/contractors/[id] — edit W-9 / contact fields. Admin only.
// TIN is reduced to last-4 on the way in (never stored in full).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const EDITABLE = new Set([
  'legal_name', 'display_name', 'business_name', 'entity_type',
  'address_line1', 'address_line2', 'city', 'state', 'zip',
  'w9_storage_path', 'active',
]);

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) updates[k] = v === '' ? null : v;
  }
  // TIN: accept full, store ONLY last-4 (never persist the full number).
  if (body.tin != null) updates.tin_last4 = String(body.tin).replace(/\D/g, '').slice(-4) || null;
  if (body.tin_last4 != null) updates.tin_last4 = String(body.tin_last4).replace(/\D/g, '').slice(-4) || null;
  // Marking a W-9 received stamps the timestamp.
  if (body.w9_storage_path || body.w9_received === true) updates.w9_received_at = new Date().toISOString();
  if (body.w9_received === false) { updates.w9_received_at = null; updates.w9_storage_path = null; }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  const db = createServiceClient();
  const { error } = await db.from('contractors').update(updates as never).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
