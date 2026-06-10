import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  extractSpotifyArtistId,
  extractYouTubeChannelInfo,
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

  // ALL platforms are link-only: the weekly agent run (Cowork) records the
  // numbers from the artist's pasted URL — no platform APIs (per Cole; the
  // Spotify/YouTube API keys were never configured in prod anyway, so the old
  // "fetch + verify" path 400'd every Spotify/YouTube link save). For spotify/
  // youtube we still PARSE the URL (pure string work, no network) so the link
  // is sanity-checked and a clean platform_id is stored when available.
  if (platform === 'spotify') {
    const artistId = extractSpotifyArtistId(url);
    if (!artistId) {
      return NextResponse.json({ error: 'Could not find a Spotify artist ID. Paste your Spotify artist URL.' }, { status: 400 });
    }
    platformId = artistId;
  } else if (platform === 'youtube') {
    const info = extractYouTubeChannelInfo(url);
    if (!info) {
      return NextResponse.json({ error: 'Could not parse YouTube URL. Paste your channel URL (e.g. youtube.com/@yourname).' }, { status: 400 });
    }
    platformId = info.value;
  } else {
    platformId = url;
  }
  displayName = null;

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
      // One pipeline: every link is recorded by the weekly agent run. No API
      // auto-fetch for any platform (the fetch-metrics cron only processes
      // auto_fetch_enabled rows, so this keeps it inert).
      auto_fetch_enabled: false,
      last_fetched_at: null,
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
