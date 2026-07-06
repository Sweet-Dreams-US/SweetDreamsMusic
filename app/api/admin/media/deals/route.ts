import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

// /api/admin/media/deals — manage promotional deals (media_deals).
//   GET    → all deals (any status) + the fixed-price offerings they can target
//   POST   → create { offering_id, title, tagline?, deal_price_cents }
//   PATCH  → update { id, active?, title?, tagline?, deal_price_cents? }
//   DELETE → remove  { id }
// While a deal is active, artist-facing surfaces show/charge its price and
// promote it (see lib/media-deals-server) — the offering row is never edited.

async function requireAdmin() {
  const supabase = await createClient();
  return verifyAdminAccess(supabase);
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const service = createServiceClient();
  const [{ data: deals }, { data: offerings }] = await Promise.all([
    service
      .from('media_deals')
      .select('id, offering_id, title, tagline, deal_price_cents, active, starts_at, ends_at, created_at')
      .order('created_at', { ascending: false }),
    // Only fixed-price offerings can carry a deal (range/quote items go
    // through the inquiry flow, where a price override has no meaning).
    service
      .from('media_offerings')
      .select('id, slug, title, price_cents, is_active')
      .not('price_cents', 'is', null)
      .order('sort_order'),
  ]);
  return NextResponse.json({ deals: deals ?? [], offerings: offerings ?? [] });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const offeringId = typeof body?.offering_id === 'string' ? body.offering_id : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const tagline = typeof body?.tagline === 'string' ? body.tagline.trim() : '';
  const price = Number(body?.deal_price_cents);
  if (!offeringId || !title || !Number.isInteger(price) || price <= 0) {
    return NextResponse.json({ error: 'offering_id, title and a positive deal_price_cents are required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: offering } = await service
    .from('media_offerings')
    .select('id, price_cents')
    .eq('id', offeringId)
    .maybeSingle();
  if (!offering) return NextResponse.json({ error: 'Offering not found' }, { status: 404 });
  if ((offering as { price_cents: number | null }).price_cents == null) {
    return NextResponse.json({ error: 'Deals require a fixed-price offering' }, { status: 400 });
  }

  const { data, error } = await service
    .from('media_deals')
    .insert({ offering_id: offeringId, title, tagline: tagline || null, deal_price_cents: price, active: true })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: (data as { id: string }).id });
}

export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.tagline === 'string') patch.tagline = body.tagline.trim() || null;
  if (body.deal_price_cents !== undefined) {
    const p = Number(body.deal_price_cents);
    if (!Number.isInteger(p) || p <= 0) return NextResponse.json({ error: 'deal_price_cents must be a positive integer' }, { status: 400 });
    patch.deal_price_cents = p;
  }

  const service = createServiceClient();
  const { error } = await service.from('media_deals').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const service = createServiceClient();
  const { error } = await service.from('media_deals').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
