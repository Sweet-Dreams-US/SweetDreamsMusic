// GET /api/admin/tax/contractors?year= — the compliance dashboard (per-person
// YTD incl. cash, W-9 status, 1099 flag). POST creates a contractor. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { contractorDashboard, getTaxConstants } from '@/lib/tax-server';

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getUTCFullYear();
  const db = createServiceClient();
  const [contractors, constants] = await Promise.all([
    contractorDashboard(db, year), getTaxConstants(db, year),
  ]);
  // Top-level threshold (independent of the card list) so the UI never falls
  // back to the repealed $600 copy; null = tax tables not configured for year.
  return NextResponse.json({ year, contractors, thresholdCents: constants?.nineteen99ThresholdCents ?? null });
}

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const legalName = String(body.legal_name || '').trim();
  if (!legalName) return NextResponse.json({ error: 'Legal name required' }, { status: 400 });
  const db = createServiceClient();
  const { data, error } = await db.from('contractors').insert({
    studio_id: null, legal_name: legalName,
    display_name: body.display_name ? String(body.display_name) : legalName,
    business_name: body.business_name ? String(body.business_name) : null,
  } as never).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: (data as { id: string }).id });
}
