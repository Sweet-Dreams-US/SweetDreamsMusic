import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { loadEngineers, revalidateEngineers } from '@/lib/engineers-server';

// Admin CRUD for the engineer roster. The canonical `name` + `email` are the
// immutable payroll identity — set at create, never edited here (renaming would
// strand historical payroll). Edits cover display/specialties/photo/bio/active/order.

/* eslint-disable @typescript-eslint/no-explicit-any */
const EDITABLE = new Set(['display_name', 'specialties', 'photo_url', 'bio', 'active', 'sort_order']);

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const engineers = await loadEngineers(createServiceClient()); // all (incl. inactive)
  return NextResponse.json({ engineers });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!name || !email) return NextResponse.json({ error: 'Name and email are required (email is the permanent payroll identity).' }, { status: 400 });

  const db = createServiceClient();
  const { data: loc } = await db.from('studios').select('id').eq('slug', 'sweet-dreams').maybeSingle();
  const { error } = await db.from('engineers').upsert({
    location_id: (loc as any)?.id ?? null,
    email, name, display_name: String(body.display_name || name),
    specialties: Array.isArray(body.specialties) ? body.specialties : [],
    bio: body.bio ?? null, photo_url: body.photo_url ?? null, active: true,
    sort_order: Number(body.sort_order) || 0,
  } as any, { onConflict: 'email' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateEngineers();
  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body.updates ?? {})) {
    if (!EDITABLE.has(k)) continue;
    if (k === 'specialties') updates[k] = Array.isArray(v) ? v : [];
    else if (k === 'active') updates[k] = Boolean(v);
    else if (k === 'sort_order') updates[k] = Number(v) || 0;
    else updates[k] = v == null ? null : String(v);
  }
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  const db = createServiceClient();
  const { error } = await db.from('engineers').update(updates as never).eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateEngineers();
  return NextResponse.json({ success: true });
}
