// POST /api/agent/metrics — the console's save path. Body:
//   { userId, runId?, confirmAnomalies?, entries: [{ platform, status, values? }] }
// Writes artist_metrics rows (source='agent'), stamps platform_connections, and
// bumps the run counters. Returns 409 with anomaly details when a value swings
// >50% vs the last verified snapshot and confirmAnomalies wasn't set — the UI
// shows an inline confirm and re-posts. Duplicates within 6 days are rejected
// per-platform (same-day re-saves are corrections and upsert). Agent or admin.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { saveAgentMetrics, type AgentEntry } from '@/lib/agent-stats-server';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'agent' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Agent only' }, { status: 403 });
  }

  let body: { userId?: string; runId?: string; confirmAnomalies?: boolean; entries?: AgentEntry[] };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.userId || !Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: 'userId and entries are required' }, { status: 400 });
  }

  try {
    const result = await saveAgentMetrics(createServiceClient(), {
      userId: body.userId,
      recordedBy: user.id,
      entries: body.entries,
      runId: body.runId ?? null,
      confirmAnomalies: body.confirmAnomalies === true,
    });
    if (result.needsConfirmation) {
      return NextResponse.json(result, { status: 409 });
    }

    // Career hooks: a fresh verified snapshot can move listener gates, the
    // 4-week streak, and listener tiers. Best-effort, never blocks recording.
    try {
      const { evaluateGates, sweepListenerTiers } = await import('@/lib/career-rules');
      const db = createServiceClient();
      await evaluateGates(db, body.userId);
      await sweepListenerTiers(db, body.userId);
    } catch (e) { console.error('[career] snapshot hook failed:', e); }

    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    console.error('[agent/metrics] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
