// GET /api/agent/queue — today's work queue for the Cowork stats agent.
// Active artists (paid in 90 days) with ≥1 platform connection, sliced by their
// stable weekday slot + missed-earlier-this-week catch-ups. Read-only.
// Agent or admin only.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { buildAgentQueue } from '@/lib/agent-stats-server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'agent' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Agent only' }, { status: 403 });
  }

  try {
    const queue = await buildAgentQueue(createServiceClient());
    return NextResponse.json(queue);
  } catch (e: unknown) {
    console.error('[agent/queue] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
