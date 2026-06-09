// POST /api/agent/anomaly — clear the anomaly hold on a reviewed agent snapshot
// so it becomes chart-eligible again. Body: { userId, platform, metricDate }.
// Agent or admin only (the console shows a "clear flag" affordance on flagged
// prior snapshots; admins can also clear from ops).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { clearAnomalyFlag } from '@/lib/agent-stats-server';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'agent' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Agent only' }, { status: 403 });
  }

  let body: { userId?: string; platform?: string; metricDate?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.userId || !body.platform || !body.metricDate) {
    return NextResponse.json({ error: 'userId, platform, metricDate required' }, { status: 400 });
  }

  try {
    const cleared = await clearAnomalyFlag(createServiceClient(), {
      userId: body.userId, platform: body.platform, metricDate: body.metricDate,
    });
    if (!cleared) return NextResponse.json({ error: 'No agent snapshot found for that date/platform' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error('[agent/anomaly] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
