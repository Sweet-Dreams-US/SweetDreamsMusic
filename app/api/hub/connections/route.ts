import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  extractSpotifyArtistId,
  fetchSpotifyArtist,
  extractYouTubeChannelInfo,
  fetchYouTubeChannel,
} from '@/lib/platform-fetch';

// GET — list all platform connections for the user
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: connections, error } = await supabase
    .from('platform_connections')
    .select('*')
    .eq('user_id', user.id)
    .order('platform');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connections: connections || [] });
}

// POST — connect a platform (paste URL, we extract the ID and verify)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { platform, url } = body;

  if (!platform || !url) {
    return NextResponse.json({ error: 'platform and url required' }, { status: 400 });
  }
  // Apple Music has no public page the API or the weekly agent can read — its
  // numbers are self-logged from the artist's own dashboard. A saved link would
  // sit dead in the tracking queue, so reject it here too (the UI doesn't offer it).
  if (platform === 'apple_music') {
    return NextResponse.json(
      { error: 'Apple Music numbers are logged manually — use "Log your Apple Music numbers" on the Metrics tab.' },
      { status: 400 },
    );
  }

  let platformId: string | null = null;
  let displayName: string | null = null;
  let profileImageUrl: string | null = null;
  let metadata: Record<string, unknown> = {};

  // ---- Spotify ----
  if (platform === 'spotify') {
    const artistId = extractSpotifyArtistId(url);
    if (!artistId) {
      return NextResponse.json({ error: 'Could not find a Spotify artist ID. Paste your Spotify artist URL.' }, { status: 400 });
    }

    const artist = await fetchSpotifyArtist(artistId);
    if (!artist) {
      return NextResponse.json({ error: 'Could not fetch Spotify artist. Check the URL and try again.' }, { status: 400 });
    }

    platformId = artistId;
    displayName = artist.name;
    profileImageUrl = artist.images?.[0]?.url || null;
    metadata = { genres: artist.genres, followers: artist.followers, popularity: artist.popularity_score };

    // Auto-log current metrics
    await supabase.from('artist_metrics').upsert({
      user_id: user.id,
      platform: 'spotify',
      metric_date: new Date().toISOString().split('T')[0],
      followers: artist.followers,
      popularity_score: artist.popularity_score,
      source: 'spotify_api',
    }, { onConflict: 'user_id,metric_date,platform' });
  }

  // ---- YouTube ----
  else if (platform === 'youtube') {
    const info = extractYouTubeChannelInfo(url);
    if (!info) {
      return NextResponse.json({ error: 'Could not parse YouTube URL. Paste your channel URL (e.g. youtube.com/@yourname).' }, { status: 400 });
    }

    const channel = await fetchYouTubeChannel(url);
    if (!channel) {
      return NextResponse.json({ error: 'Could not fetch YouTube channel. Check the URL and try again.' }, { status: 400 });
    }

    platformId = channel.channelId;
    displayName = channel.name;
    profileImageUrl = channel.thumbnail || null;
    metadata = { subscribers: channel.subscribers, total_views: channel.total_views, videos_count: channel.videos_count };

    // Auto-log current metrics
    await supabase.from('artist_metrics').upsert({
      user_id: user.id,
      platform: 'youtube',
      metric_date: new Date().toISOString().split('T')[0],
      subscribers: channel.subscribers,
      total_views: channel.total_views,
      videos_count: channel.videos_count,
      source: 'youtube_api',
    }, { onConflict: 'user_id,metric_date,platform' });
  }

  // ---- Other platforms (manual connection — just store the URL) ----
  else {
    platformId = url;
    displayName = null;
  }

  // Upsert the connection
  const { data: connection, error } = await supabase
    .from('platform_connections')
    .upsert({
      user_id: user.id,
      platform,
      platform_id: platformId,
      platform_url: url,
      display_name: displayName,
      profile_image_url: profileImageUrl,
      auto_fetch_enabled: ['spotify', 'youtube'].includes(platform),
      last_fetched_at: ['spotify', 'youtube'].includes(platform) ? new Date().toISOString() : null,
      metadata,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ connection, verified: !!displayName });
}

// DELETE — disconnect a platform
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform');
  if (!platform) return NextResponse.json({ error: 'platform required' }, { status: 400 });

  const { error } = await supabase
    .from('platform_connections')
    .delete()
    .eq('user_id', user.id)
    .eq('platform', platform);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ disconnected: true });
}
