import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  return NextResponse.json({
    projects: projectsRes.data || [],
    goals: goalsRes.data || [],
    latestMetrics,
    achievements: achievementsRes.data || [],
    upcomingSessions: sessionsRes.data || [],
    completedSessions: completedSessionsRes.data || [],
    upcomingEvents: calendarRes.data || [],
  });
}
