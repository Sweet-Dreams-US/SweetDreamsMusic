// /api/admin/rewards/rules — list + edit the reward ladder (the admin "tune the
// numbers without code" surface). GET lists DB rules (falls back to the lib seed
// if the table is empty so the editor always shows the ladder). PATCH updates one
// rule's editable fields. Admin-only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { REWARD_RULES } from '@/lib/rewards';

/* eslint-disable @typescript-eslint/no-explicit-any */

const EDITABLE = new Set(['label', 'threshold', 'reward_value', 'reward_cap_cents', 'issuance', 'stack_mode', 'expires_days', 'active', 'sort_order', 'notes']);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = createServiceClient();
  const { data } = await db.from('reward_rules').select('*').order('sort_order', { ascending: true });
  // DB column is window_kind ('window' is reserved in Postgres); expose it as
  // `window` so the API shape matches the TS ruleset + the UI everywhere.
  if (data && data.length) {
    const rules = data.map((r: any) => ({ ...r, window: r.window_kind }));
    return NextResponse.json({ rules, seeded: true });
  }

  // Table empty (migration applied but not yet seeded) → show the lib defaults.
  return NextResponse.json({ rules: REWARD_RULES.map((r, i) => ({ id: null, seeded: false, ...r, sort_order: r.sort_order ?? i })), seeded: false });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = body.id ? String(body.id) : null;
  if (!id) return NextResponse.json({ error: 'Rule id required (seed the rules first)' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (EDITABLE.has(k)) updates[k] = v;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });

  const db = createServiceClient();
  const { error } = await db.from('reward_rules').update(updates as any).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
