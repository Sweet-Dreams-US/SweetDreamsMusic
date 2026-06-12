// app/api/admin/media/offerings/route.ts
//
// Admin-only catalog management. The MediaCatalog UI calls these to list
// every offering (active + inactive) and to create new ones. Edits go to
// the [id] sibling route.
//
// Auth: 401 if not logged in, 403 if not admin. We rely on the role check
// rather than RLS here because admin needs to see inactive rows too, which
// the public RLS policy blocks.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getAllOfferingsForAdmin } from '@/lib/media-server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const offerings = await getAllOfferingsForAdmin();
  return NextResponse.json({ offerings });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Required fields. Pricing fields are optional individually but at least
  // one of (price_cents) OR (range_low + range_high) OR (none → inquire)
  // must make sense. We let the DB CHECK constraints catch most of it and
  // just enforce the truly required identity fields here.
  const slug = String(body.slug || '').trim();
  const title = String(body.title || '').trim();
  const kind = String(body.kind || '');
  const eligibility = String(body.eligibility || '');

  if (!slug || !title) {
    return NextResponse.json({ error: 'slug and title required' }, { status: 400 });
  }
  if (!['standalone', 'package'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be standalone or package' }, { status: 400 });
  }
  if (!['solo', 'band', 'both', 'band-by-request'].includes(eligibility)) {
    return NextResponse.json({ error: 'eligibility invalid' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('media_offerings')
    .insert({
      slug,
      title,
      description: body.description || null,
      kind,
      eligibility,
      price_cents: body.price_cents ?? null,
      price_range_low_cents: body.price_range_low_cents ?? null,
      price_range_high_cents: body.price_range_high_cents ?? null,
      components: body.components ?? null,
      studio_hours_included: body.studio_hours_included ?? 0,
      public_blurb: body.public_blurb ?? null,
      is_active: body.is_active ?? true,
      sort_order: body.sort_order ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[admin/media/offerings] insert error:', error);
    // Slug clash is the most likely 23505 here.
    const message = error.code === '23505'
      ? 'An offering with that slug already exists'
      : 'Could not create offering';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ offering: data });
}
