import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchSpotifyArtist, fetchYouTubeChannel } from '@/lib/platform-fetch';
import { sweepPauseNotices } from '@/lib/agent-stats-server';
import { sendTrackingPausedEmail } from '@/lib/email';

// Vercel Cron: Auto-fetch metrics from connected platforms
// Runs daily at 6am UTC. Doubles as the agent-console prefill (the console shows
// today's spotify_api/youtube_api values in its input boxes) and runs the
// tracking-paused win-back email sweep.
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().split('T')[0];
  let fetched = 0;
  let errors = 0;

  // Get all active connections that haven't been fetched today
  const { data: connections } = await supabase
    .from('platform_connections')
    .select('*')
    .eq('auto_fetch_enabled', true)
    .in('platform', ['spotify', 'youtube'])
    .or(`last_fetched_at.is.null,last_fetched_at.lt.${today}T00:00:00Z`);

  for (const conn of connections ?? []) {
    try {
      // Never clobber a human-verified row: if the agent already recorded this
      // platform today, the api prefill is redundant (the agent save merged any
      // api-only fields it didn't enter).
      const { data: existing } = await supabase.from('artist_metrics')
        .select('source').eq('user_id', conn.user_id).eq('platform', conn.platform)
        .eq('metric_date', today).maybeSingle();
      if (existing?.source === 'agent') continue;

      if (conn.platform === 'spotify' && conn.platform_id) {
        const artist = await fetchSpotifyArtist(conn.platform_id);
        if (artist) {
          await supabase.from('artist_metrics').upsert({
            user_id: conn.user_id,
            platform: 'spotify',
            metric_date: today,
            followers: artist.followers,
            popularity_score: artist.popularity_score,
            source: 'spotify_api',
          }, { onConflict: 'user_id,metric_date,platform' });

          await supabase.from('platform_connections').update({
            last_fetched_at: new Date().toISOString(),
            fetch_error: null,
            display_name: artist.name,
            profile_image_url: artist.images?.[0]?.url || conn.profile_image_url,
            metadata: { ...((conn.metadata as Record<string, unknown>) || {}), genres: artist.genres, followers: artist.followers, popularity: artist.popularity_score },
          }).eq('id', conn.id);

          fetched++;
        }
      }

      if (conn.platform === 'youtube' && conn.platform_id) {
        // For YouTube we stored channelId, construct a URL-like input for the fetcher
        const channel = await fetchYouTubeChannel(conn.platform_id);
        if (channel) {
          await supabase.from('artist_metrics').upsert({
            user_id: conn.user_id,
            platform: 'youtube',
            metric_date: today,
            subscribers: channel.subscribers,
            total_views: channel.total_views,
            videos_count: channel.videos_count,
            source: 'youtube_api',
          }, { onConflict: 'user_id,metric_date,platform' });

          await supabase.from('platform_connections').update({
            last_fetched_at: new Date().toISOString(),
            fetch_error: null,
            display_name: channel.name,
            profile_image_url: channel.thumbnail || conn.profile_image_url,
            metadata: { ...((conn.metadata as Record<string, unknown>) || {}), subscribers: channel.subscribers, total_views: channel.total_views, videos_count: channel.videos_count },
          }).eq('id', conn.id);

          fetched++;
        }
      }
    } catch (err) {
      errors++;
      await supabase.from('platform_connections').update({
        fetch_error: err instanceof Error ? err.message : 'Unknown error',
      }).eq('id', conn.id);
    }
  }

  // Tracking-paused win-back sweep: artists with links whose 90-day paid window
  // lapsed get ONE email per pause episode ("book anything and it resumes").
  // Non-fatal — a Resend hiccup must not fail the metrics fetch.
  let pauseSweep: { candidates: number; notified: number } = { candidates: 0, notified: 0 };
  try {
    pauseSweep = await sweepPauseNotices(supabase, sendTrackingPausedEmail);
  } catch (e) {
    console.error('[fetch-metrics] pause sweep failed:', e);
  }

  return NextResponse.json({ fetched, errors, total: connections?.length ?? 0, pauseSweep });
}
