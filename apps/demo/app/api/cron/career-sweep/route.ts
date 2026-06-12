import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { evaluateGates, sweepListenerTiers } from '@/lib/career-rules';

export const maxDuration = 300;

// Nightly career sweep (Plan 6 §6): re-evaluates gates for every user with any
// career surface area (event hooks catch most transitions same-second; this
// catches the stragglers — e.g. time-based rules like releases_in_12mo aging),
// sweeps listener tiers, and auto-syncs streaming/social goal progress from
// the latest verified snapshots.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = createServiceClient();
  const summary = { evaluated: 0, stageUps: 0, tiersGranted: 0, goalsSynced: 0 };
  try {
    // Users with career surface: anyone with requirement progress, platform
    // links, projects, or agent snapshots. Paginated — PostgREST caps each
    // query at 1000 rows, and the studio will cross that as it grows.
    const collectUsers = async (table: string): Promise<string[]> => {
      const out: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await db.from(table).select('user_id')
          .order('user_id', { ascending: true }).range(from, from + 999); // stable order across pages
        const rows = (data ?? []) as any[];
        out.push(...rows.map((r) => r.user_id));
        if (rows.length < 1000) break;
      }
      return out;
    };
    const [a, b, c] = await Promise.all([
      collectUsers('platform_connections'),
      collectUsers('artist_projects'),
      collectUsers('requirement_progress'),
    ]);
    const userIds = Array.from(new Set([...a, ...b, ...c].filter(Boolean)));

    for (const uid of userIds) {
      try {
        const res = await evaluateGates(db, uid);
        summary.evaluated++;
        if (res.stageUp) summary.stageUps++;
      } catch (e) { console.error(`[career-sweep] evaluate failed (${uid}):`, e); }
    }

    const tiers = await sweepListenerTiers(db);
    summary.tiersGranted = tiers.granted.length;

    // Goal auto-sync: streaming/social goals with a linked platform track the
    // latest verified snapshot's primary number. Bars move on their own.
    const { data: goals } = await db.from('artist_goals')
      .select('id,user_id,category,linked_platform,target_value,current_value,status')
      .eq('status', 'active').in('category', ['streaming', 'social'])
      .not('linked_platform', 'is', null);
    for (const g of ((goals ?? []) as any[])) {
      const { data: snap } = await db.from('artist_metrics')
        .select('monthly_listeners,followers,subscribers,metadata')
        .eq('user_id', g.user_id).eq('platform', g.linked_platform).eq('source', 'agent')
        .order('metric_date', { ascending: false }).limit(1).maybeSingle();
      if (!snap) continue;
      const s = snap as any;
      if (s.metadata?.anomaly === true) continue;
      const value = g.category === 'streaming'
        ? (s.monthly_listeners ?? s.followers ?? null)
        : (s.followers ?? s.subscribers ?? null);
      if (value == null || Number(value) === Number(g.current_value)) continue;
      const updates: Record<string, unknown> = { current_value: Number(value), auto_synced_at: new Date().toISOString() };
      if (g.target_value != null && Number(value) >= Number(g.target_value)) {
        updates.status = 'completed'; updates.completed_at = new Date().toISOString();
      }
      const { error } = await db.from('artist_goals').update(updates as never).eq('id', g.id);
      if (!error) summary.goalsSynced++;
    }

    console.log('[cron/career-sweep]', JSON.stringify(summary));
    return NextResponse.json({ success: true, ...summary });
  } catch (e) {
    console.error('[cron/career-sweep] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed', ...summary }, { status: 500 });
  }
}
