import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { sendPendingBroadcast } from '@/lib/broadcast-send';

/**
 * POST /api/admin/broadcasts/[id]/resume
 *
 * Re-send ONLY to recipients still 'pending' or 'failed'. A recipient already
 * marked 'sent' is never loaded by sendPendingBroadcast, so it is NEVER
 * re-sent — making this safe to click repeatedly until everyone is 'sent'.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  }

  try {
    const { sent, failed, pending } = await sendPendingBroadcast(id);
    return NextResponse.json({
      broadcastId: id,
      sentCount: sent,
      failedCount: failed,
      pending,
      total: sent + failed + pending,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
