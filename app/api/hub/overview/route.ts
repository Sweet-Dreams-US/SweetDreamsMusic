import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { buildContext, nextSteps, getCareerSummary } from '@/lib/career-rules';
import { TIER_LADDER } from '@/lib/career';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const [projectsRes, goalsRes, metricsRes, achievementsRes, sessionsRes, completedSessionsRes, calendarRes] = await Promise.all([
    supabase.from('artist_projects').select('id, title, project_type, current_phase, target_release_date, status, cover_image_url')
      .eq('user_id', user.id).eq('status', 'active').order('updated_at', { ascending: false }).limit(3),
    supabase.from('artist_goals').select('id, title, category, target_value, current_value, target_date, status')
      .eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false }).limit(3),
    supabase.from('artist_metrics').select('*')
      .eq('user_id', user.id).order('metric_date', { ascending: false }).limit(10),
    supabase.from('artist_achievements').select('achievement_key, unlocked_at')
      .eq('user_id', user.id).order('unlocked_at', { ascending: false }),
    supabase.from('bookings').select('id, start_time, duration, room, status, engineer_name')
      .eq('customer_email', user.email!).in('status', ['confirmed', 'pending']).gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true }).limit(3),
    // Completed sessions for session notes
    supabase.from('bookings').select('id, start_time, duration, room, status, engineer_name')
      .eq('customer_email', user.email!).eq('status', 'completed')
      .order('start_time', { ascending: false }).limit(20),
    // Upcoming calendar events (next 5)
    supabase.from('calendar_events').select('id, title, event_type, event_date, event_time, color')
      .eq('user_id', user.id).gte('event_date', new Date().toISOString().split('T')[0])
      .order('event_date', { ascending: true }).limit(5),
  ]);

  // Latest metrics by platform
  const latestMetrics: Record<string, Record<string, unknown>> = {};
  for (const m of metricsRes.data || []) {
    if (!latestMetrics[m.platform]) latestMetrics[m.platform] = m;
  }

  // Career layer: next steps + stage/tier cards + weekly verified deltas
  // (deltas, never just totals — Plan 6 §7). All service-client, best-effort.
  let career: Record<string, unknown> | null = null;
  try {
    const db = createServiceClient();
    const [ctx, summary, weekly] = await Promise.all([
      buildContext(db, user.id),
      getCareerSummary(db, user.id),
      db.from('artist_metrics')
        .select('platform,metric_date,followers,monthly_listeners,subscribers,metadata')
        .eq('user_id', user.id).eq('source', 'agent')
        .order('metric_date', { ascending: false }).limit(20),
    ]);

    // Week-over-week deltas per platform from the two latest verified rows.
    const byPlatform = new Map<string, any[]>();
    for (const m of ((weekly.data ?? []) as any[])) {
      if (m.metadata?.anomaly === true) continue;
      if (!byPlatform.has(m.platform)) byPlatform.set(m.platform, []);
      const arr = byPlatform.get(m.platform)!;
      if (arr.length < 2) arr.push(m);
    }
    const weekDeltas: { platform: string; metric: string; delta: number; current: number }[] = [];
    let lastUpdated: string | null = null;
    for (const [platform, rows] of byPlatform) {
      if (rows.length === 0) continue;
      lastUpdated = lastUpdated && lastUpdated > rows[0].metric_date ? lastUpdated : rows[0].metric_date;
      if (rows.length < 2) continue;
      // Only call it a weekly delta when the two snapshots really are about a
      // week apart — a gap spanning a month of missed checks isn't "this week".
      const { daysBetweenIso, CONSECUTIVE_MAX_DAYS } = await import('@/lib/career');
      if (daysBetweenIso(rows[1].metric_date, rows[0].metric_date) > CONSECUTIVE_MAX_DAYS) continue;
      const field = platform === 'spotify' ? 'monthly_listeners' : platform === 'youtube' ? 'subscribers' : 'followers';
      const cur = Number(rows[0][field] ?? rows[0].followers) || 0;
      const prev = Number(rows[1][field] ?? rows[1].followers) || 0;
      if (cur || prev) weekDeltas.push({ platform, metric: field, delta: cur - prev, current: cur });
    }

    const nextTier = TIER_LADDER.find((t) => t > (summary.highestTier ?? 0)) ?? null;
    career = {
      nextSteps: nextSteps(ctx, { stage: summary.stage }).slice(0, 3),
      stage: summary.stage,
      stageLabel: summary.stageLabel,
      stageGates: summary.requirements.filter((r: any) => r.stage === summary.stage + 1),
      highestTier: summary.highestTier,
      nextTier,
      currentListeners: ctx.latestVerifiedListeners,
      weekDeltas: weekDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      lastUpdated,
    };
  } catch (e) { console.error('[overview] career layer failed:', e); }

  return NextResponse.json({
    projects: projectsRes.data || [],
    goals: goalsRes.data || [],
    latestMetrics,
    achievements: achievementsRes.data || [],
    upcomingSessions: sessionsRes.data || [],
    completedSessions: completedSessionsRes.data || [],
    upcomingEvents: calendarRes.data || [],
    career,
  });
}
