// app/api/engineer/media-sessions/route.ts
//
// Read-only feed of media sessions assigned to the logged-in engineer.
// Used by the new "Media" tab on the engineer dashboard. Returns the
// session row + parent booking offering title + buyer name so the
// engineer can see what they're shooting for and who they're shooting
// for in one row.
//
// Auth: must be a logged-in engineer or admin. We don't expose any
// payment-sensitive fields; the engineer sees only their own work.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'engineer' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Engineer-only' }, { status: 403 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('media_session_bookings')
    .select(`
      id, parent_booking_id, starts_at, ends_at, location,
      external_location_text, session_kind, status, notes,
      engineer_payout_cents, engineer_payout_paid_at
    `)
    .eq('engineer_id', user.id)
    .order('starts_at', { ascending: true });

  if (error) {
    console.error('[engineer/media-sessions] read error:', error);
    return NextResponse.json({ error: 'Could not load sessions' }, { status: 500 });
  }

  type Row = {
    id: string;
    parent_booking_id: string;
    starts_at: string;
    ends_at: string;
    location: string;
    external_location_text: string | null;
    session_kind: string;
    status: string;
    notes: string | null;
    engineer_payout_cents: number | null;
    engineer_payout_paid_at: string | null;
  };
  const rows = (data || []) as Row[];

  // Hydrate parent booking → offering title + buyer name in one batch.
  const parentIds = Array.from(new Set(rows.map((r) => r.parent_booking_id)));
  if (parentIds.length === 0) {
    return NextResponse.json({ sessions: rows, parents: [] });
  }
  // Pull project_details + configured_components alongside the parent
  // booking — engineers reading their schedule shouldn't need to dig into
  // the buyer's order detail page to see what the project actually is.
  const { data: parents } = await service
    .from('media_bookings')
    .select('id, offering_id, user_id, band_id, project_details, configured_components')
    .in('id', parentIds);
  const parentRows = (parents || []) as Array<{
    id: string;
    offering_id: string;
    user_id: string;
    band_id: string | null;
    project_details: Record<string, unknown> | null;
    configured_components: unknown | null;
  }>;
  const offeringIds = Array.from(new Set(parentRows.map((p) => p.offering_id)));
  const buyerIds = Array.from(new Set(parentRows.map((p) => p.user_id)));
  const bandIds = Array.from(new Set(parentRows.map((p) => p.band_id).filter((x): x is string => !!x)));

  const [offRes, profRes, bandRes] = await Promise.all([
    offeringIds.length
      ? service.from('media_offerings').select('id, title').in('id', offeringIds)
      : Promise.resolve({ data: [] }),
    buyerIds.length
      ? service.from('profiles').select('user_id, display_name, email').in('user_id', buyerIds)
      : Promise.resolve({ data: [] }),
    bandIds.length
      ? service.from('bands').select('id, display_name').in('id', bandIds)
      : Promise.resolve({ data: [] }),
  ]);
  return NextResponse.json({
    sessions: rows,
    parents: parentRows,
    offerings: offRes.data ?? [],
    profiles: profRes.data ?? [],
    bands: bandRes.data ?? [],
  });
}
