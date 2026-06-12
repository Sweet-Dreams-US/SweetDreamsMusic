// app/api/admin/packages/addon-requests/[id]/route.ts
//
// PATCH — admin updates an add-on request. Supports two flavors:
//   • { status: 'declined', admin_response_notes }
//     Marks the request declined with a reason. No quote generated.
//   • { status: 'quoted', response_quote_id, admin_response_notes? }
//     Marks the request as quoted; admin generated a follow-up quote
//     elsewhere (Round C's quote-from-template flow) and pasted the
//     id here so the customer can correlate.
//
// No POST/DELETE — admin-initiated cancel of a pending request would
// just be a 'declined' status update.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

interface PatchBody {
  status?: 'pending' | 'quoted' | 'accepted' | 'declined';
  response_quote_id?: string | null;
  admin_response_notes?: string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: PatchBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.status) {
    if (!['pending', 'quoted', 'accepted', 'declined'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = body.status;
    if (body.status === 'declined' || body.status === 'accepted') {
      update.resolved_at = new Date().toISOString();
    }
  }
  if (body.response_quote_id !== undefined) update.response_quote_id = body.response_quote_id;
  if (body.admin_response_notes !== undefined) update.admin_response_notes = body.admin_response_notes;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from('package_addon_requests')
    .update(update)
    .eq('id', id);
  if (error) {
    console.error('[admin/addon-requests PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
