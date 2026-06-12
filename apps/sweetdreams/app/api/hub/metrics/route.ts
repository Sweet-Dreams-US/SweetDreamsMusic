import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform');
  const days = parseInt(searchParams.get('days') || '90');

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  let query = supabase
    .from('artist_metrics')
    .select('*')
    .eq('user_id', user.id)
    .gte('metric_date', fromDate.toISOString().split('T')[0])
    .order('metric_date', { ascending: true });

  if (platform) query = query.eq('platform', platform);

  const { data: metrics, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ metrics: metrics || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { entries } = body; // array of { platform, metric_date, followers, streams, etc. }

  if (!entries || !Array.isArray(entries)) {
    return NextResponse.json({ error: 'entries array required' }, { status: 400 });
  }

  const records = entries.map((e: Record<string, unknown>) => ({
    user_id: user.id,
    platform: e.platform,
    metric_date: e.metric_date,
    // Original fields
    followers: e.followers || null,
    streams: e.streams || null,
    engagement_rate: e.engagement_rate || null,
    monthly_listeners: e.monthly_listeners || null,
    subscribers: e.subscribers || null,
    // New expanded fields
    saves: e.saves || null,
    playlist_adds: e.playlist_adds || null,
    popularity_score: e.popularity_score || null,
    plays: e.plays || null,
    shazams: e.shazams || null,
    avg_likes: e.avg_likes || null,
    avg_comments: e.avg_comments || null,
    reels_views: e.reels_views || null,
    posts_count: e.posts_count || null,
    total_likes: e.total_likes || null,
    avg_views: e.avg_views || null,
    videos_count: e.videos_count || null,
    total_views: e.total_views || null,
    watch_hours: e.watch_hours || null,
    reposts: e.reposts || null,
    comments: e.comments || null,
    impressions: e.impressions || null,
    // ALWAYS 'manual' — never trust a client-supplied source. Chart eligibility
    // (chart_eligible_metrics, migration 075) keys off source ∈ agent/spotify_api/
    // youtube_api; honoring e.source would let an artist self-write 'agent' rows
    // and fake their way onto DreamSuite Charts. Verified sources are written
    // only by the agent console route + the fetch-metrics cron (service-side).
    source: 'manual',
  }));

  // Never let a manual log OVERWRITE a verified row (agent / API source) for the
  // same day+platform — that would erase the chart-eligible snapshot. Manual
  // entries only fill days the verified pipeline didn't cover.
  const dates = Array.from(new Set(records.map((r) => r.metric_date)));
  const platforms = Array.from(new Set(records.map((r) => r.platform)));
  const { data: verifiedRows } = await supabase
    .from('artist_metrics')
    .select('metric_date,platform')
    .eq('user_id', user.id)
    .in('metric_date', dates as string[])
    .in('platform', platforms as string[])
    .in('source', ['agent', 'spotify_api', 'youtube_api']);
  const verifiedKeys = new Set((verifiedRows ?? []).map((r) => `${r.metric_date}|${r.platform}`));
  const writable = records.filter((r) => !verifiedKeys.has(`${r.metric_date}|${r.platform}`));

  if (writable.length > 0) {
    // Upsert (unique on user_id, metric_date, platform)
    const { error } = await supabase
      .from('artist_metrics')
      .upsert(writable, { onConflict: 'user_id,metric_date,platform' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: true, written: writable.length, skippedVerified: records.length - writable.length });
}
