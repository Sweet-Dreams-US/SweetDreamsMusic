// app/api/admin/packages/addon-requests/route.ts
//
// GET — admin list of all add-on requests with hydrated requester +
// entitlement + template names. Supports ?status= filter (pending /
// quoted / accepted / declined).

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status'); // 'pending','quoted','accepted','declined' or null

  const service = createServiceClient();

  let query = service
    .from('package_addon_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) {
    console.error('[admin/addon-requests GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string; entitlement_id: string; requested_by_user_id: string;
    request_type: string; quantity: number; media_offering_id: string | null;
    notes: string | null; status: string; response_quote_id: string | null;
    admin_response_notes: string | null; created_at: string; resolved_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  if (rows.length === 0) return NextResponse.json({ requests: [] });

  // Hydrate requester profiles, entitlement → template names.
  const userIds = Array.from(new Set(rows.map((r) => r.requested_by_user_id)));
  const entIds = Array.from(new Set(rows.map((r) => r.entitlement_id)));

  const [{ data: profiles }, { data: entitlements }] = await Promise.all([
    service.from('profiles').select('user_id, display_name, email').in('user_id', userIds),
    service
      .from('package_entitlements')
      .select('id, template_id, user_id, band_id')
      .in('id', entIds),
  ]);

  const profMap = new Map<string, { display_name: string | null; email: string | null }>();
  for (const p of (profiles ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
    profMap.set(p.user_id, p);
  }

  const entMap = new Map<string, { template_id: string; user_id: string | null; band_id: string | null }>();
  for (const e of (entitlements ?? []) as Array<{ id: string; template_id: string; user_id: string | null; band_id: string | null }>) {
    entMap.set(e.id, e);
  }

  const tplIds = Array.from(new Set([...entMap.values()].map((e) => e.template_id)));
  const { data: templates } = tplIds.length
    ? await service.from('package_templates').select('id, name').in('id', tplIds)
    : { data: [] };
  const tplMap = new Map<string, string>();
  for (const t of (templates ?? []) as Array<{ id: string; name: string }>) {
    tplMap.set(t.id, t.name);
  }

  const hydrated = rows.map((r) => {
    const ent = entMap.get(r.entitlement_id);
    const profile = profMap.get(r.requested_by_user_id);
    return {
      ...r,
      requester_name: profile?.display_name ?? null,
      requester_email: profile?.email ?? null,
      template_name: ent ? (tplMap.get(ent.template_id) ?? '(template missing)') : '(entitlement missing)',
    };
  });

  return NextResponse.json({ requests: hydrated });
}
