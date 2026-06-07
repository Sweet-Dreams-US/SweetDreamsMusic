import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getBrandRow, revalidateBrand } from '@/lib/brand-server';

// Admin editor for brand identity (brand_settings singleton). White-label studios
// set their own name/contact/address here without code.

const EDITABLE = new Set([
  'name', 'legal_name', 'tagline', 'phone', 'email',
  'addr_street', 'addr_city', 'addr_state', 'addr_zip', 'addr_country',
]);

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const brand = await getBrandRow(createServiceClient());
  return NextResponse.json({ brand });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (EDITABLE.has(k)) updates[k] = v == null ? '' : String(v);
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  if (updates.name !== undefined && updates.name.trim() === '') return NextResponse.json({ error: 'Studio name is required' }, { status: 400 });

  const db = createServiceClient();
  const { error } = await db.from('brand_settings').update(updates as never).is('studio_id', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidateBrand();
  return NextResponse.json({ success: true });
}
