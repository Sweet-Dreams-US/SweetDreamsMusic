import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { syncMetaLeads, PageAccessError } from '@/lib/meta-leads';

// /api/admin/marketing/leads — Meta ad leads for the Marketing tab.
//   GET   → list stored leads (newest first; ?status= filter optional)
//   POST  → pull latest from Meta now (manual "Sync" button)
//   PATCH → update one lead's status/notes ({ id, status?, notes? })
// meta_leads is service-role-only (RLS with no policies), so all access runs
// through the service client behind the admin gate.

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const status = new URL(request.url).searchParams.get('status');

  const service = createServiceClient();
  let q = service
    .from('meta_leads')
    .select('id, leadgen_id, form_name, campaign_name, ad_name, full_name, email, phone, created_time, status, notes, synced_at')
    .order('created_time', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [] });
}

export async function POST() {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const service = createServiceClient();
  try {
    const report = await syncMetaLeads(service);
    return NextResponse.json({ success: true, ...report });
  } catch (e) {
    if (e instanceof PageAccessError) {
      // Not a server fault — the Page asset isn't assigned yet. 409 lets the
      // UI show the setup instructions instead of a generic failure.
      return NextResponse.json({ error: e.message, pageAccess: false }, { status: 409 });
    }
    console.error('[admin/marketing/leads] sync failed:', e);
    return NextResponse.json({ error: 'Lead sync failed' }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const id = body?.id ? String(body.id) : '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, string> = {};
  if (typeof body.status === 'string' && ['new', 'contacted', 'converted', 'ignored'].includes(body.status)) {
    patch.status = body.status;
  }
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service.from('meta_leads').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
