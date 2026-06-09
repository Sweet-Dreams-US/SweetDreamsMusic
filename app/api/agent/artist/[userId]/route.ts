// GET /api/agent/artist/[userId] — the per-artist work screen payload: profile
// header, every AGENT_PLATFORM with the artist's pasted link, the last agent
// snapshot (anomaly baseline + display), and today's free-API prefill values.
// Agent or admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getArtistWork } from '@/lib/agent-stats-server';

export async function GET(request: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'agent' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Agent only' }, { status: 403 });
  }

  const { userId } = await ctx.params;
  try {
    const work = await getArtistWork(createServiceClient(), userId);
    if (!work) return NextResponse.json({ error: 'Artist not found' }, { status: 404 });
    return NextResponse.json(work);
  } catch (e: unknown) {
    console.error('[agent/artist] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
