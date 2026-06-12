// POST /api/agent/runs — { action: 'start' } returns (or creates) today's open
// run; { action: 'finish', runId } closes it and returns the summary row for
// Cowork's end-of-day report. GET returns today's runs. Agent or admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { startAgentRun, finishAgentRun } from '@/lib/agent-stats-server';
import { studioToday } from '@/lib/agent-stats';

async function gate() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'agent' && user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Agent only' }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const g = await gate();
  if (g.error) return g.error;
  const db = createServiceClient();
  const { dateStr } = studioToday();
  const { data } = await db.from('agent_runs').select('*')
    .eq('run_date', dateStr).order('started_at', { ascending: false });
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(request: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;

  let body: { action?: string; runId?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = createServiceClient();
  try {
    if (body.action === 'start') {
      const run = await startAgentRun(db, g.user!.id);
      return NextResponse.json({ success: true, run });
    }
    if (body.action === 'finish' && body.runId) {
      const run = await finishAgentRun(db, body.runId);
      return NextResponse.json({ success: true, run });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: unknown) {
    console.error('[agent/runs] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
