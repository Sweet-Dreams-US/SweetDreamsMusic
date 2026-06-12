// app/api/admin/media/offerings/[id]/route.ts
//
// Per-row admin catalog operations. PATCH for partial updates, DELETE for
// soft-delete (we flip is_active=false rather than removing the row, so
// existing media_bookings can keep their offering_id FK pointing somewhere
// real).
//
// Auth model mirrors the parent route: admin-only, service role for the
// write so RLS doesn't block admin edits to inactive rows.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const ALLOWED_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'kind',
  'eligibility',
  'price_cents',
  'price_range_low_cents',
  'price_range_high_cents',
  'components',
  'studio_hours_included',
  'public_blurb',
  'is_active',
  'sort_order',
  // slug is intentionally NOT updatable — buyers may have bookmarked URLs,
  // and changing the slug would 404 them. Admin can soft-delete + recreate
  // if they need to rename.
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Whitelist the fields. Anything not in ALLOWED_UPDATE_FIELDS is silently
  // dropped — we don't want a malformed admin form to accidentally write
  // arbitrary columns.
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_UPDATE_FIELDS.has(key)) {
      update[key] = value;
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields in request' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('media_offerings')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('[admin/media/offerings] update error:', error);
    return NextResponse.json({ error: 'Could not update offering' }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Offering not found' }, { status: 404 });
  }
  return NextResponse.json({ offering: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id } = await params;

  // Soft-delete only. Existing bookings reference offering_id; hard-delete
  // would either cascade and orphan history or fail the FK. is_active=false
  // keeps the row but hides it from every catalog read (RLS + the active
  // filter in getActiveOfferings).
  const service = createServiceClient();
  const { error } = await service
    .from('media_offerings')
    .update({ is_active: false })
    .eq('id', id);

  if (error) {
    console.error('[admin/media/offerings] deactivate error:', error);
    return NextResponse.json({ error: 'Could not deactivate' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
