// GET /api/hub/tracking-status — the signed-in artist's own tracking state for
// the hub Metrics tab: paused banner + "book to resume" messaging. Reads the
// artist_tracking_status view with the SERVICE client (security_invoker view —
// a user-scoped client would empty its laterals under RLS); identity comes from
// the session, so this only ever exposes the caller's own status.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getTrackingStatus } from '@/lib/agent-stats-server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  try {
    const db = createServiceClient();
    const [status, { count }] = await Promise.all([
      getTrackingStatus(db, user.id),
      db.from('platform_connections').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);
    return NextResponse.json({
      isActive: status.isActive,
      lastPaidAt: status.lastPaidAt,
      connectionCount: count ?? 0,
      // Paused only means something once they're in the tracking program.
      paused: (count ?? 0) > 0 && !status.isActive,
    });
  } catch (e: unknown) {
    console.error('[hub/tracking-status] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
