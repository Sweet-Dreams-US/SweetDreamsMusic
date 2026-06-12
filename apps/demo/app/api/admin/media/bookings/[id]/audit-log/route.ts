// app/api/admin/media/bookings/[id]/audit-log/route.ts
//
// Admin reads the full audit trail of a single media booking. Powers the
// "Order history" panel inside the Media Orders admin UI — every charge,
// payment, component completion, price adjustment, and manual event
// shows up here in chronological order.
//
// Why a dedicated endpoint vs. inlining the read on the bookings GET:
//   • The list view doesn't need history per row (200-row pagination
//     would explode if we joined audit_log every time).
//   • Admin only opens history when investigating a specific row.
//   • Keeps the GET /admin/media/bookings response shape stable.
//
// Auth: admin-only. Returns 200 [] for bookings with no audit entries
// (rather than 404) so the panel can render an empty-state message
// without a special error path.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;

  const service = createServiceClient();

  // Confirm the booking exists first so we don't leak audit-log shape
  // for nonexistent IDs (defense-in-depth — RLS would also block this,
  // but we have explicit admin auth here so we want a clean 404).
  const { data: booking } = await service
    .from('media_bookings')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const { data: entries, error } = await service
    .from('media_booking_audit_log')
    .select('id, action, performed_by, details, created_at')
    .eq('booking_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[admin/media/bookings/audit-log] read error:', error);
    return NextResponse.json(
      { error: 'Could not load audit log' },
      { status: 500 },
    );
  }

  return NextResponse.json({ entries: entries || [] });
}
