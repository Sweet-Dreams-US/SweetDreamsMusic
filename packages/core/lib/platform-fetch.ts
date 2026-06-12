// ============================================================
// Platform Auto-Fetch: Spotify & YouTube public API helpers
// ============================================================

// ---- Spotify (Client Credentials Flow — no user OAuth) ----

interface SpotifyArtistData {
  followers: number;
  popularity_score: number;
  name: string;
  images: { url: string; width: number; height: number }[];
  genres: string[];
}

// Extract Spotify artist ID from various URL formats
// e.g. https://open.spotify.com/artist/6eUKZXaKkcviH0Ku9w2n3V
// e.g. spotify:artist:6eUKZXaKkcviH0Ku9w2n3V
export function extractSpotifyArtistId(input: string): string | null {
  // Direct ID (22 chars alphanumeric)
  if (/^[a-zA-Z0-9]{22}$/.test(input.trim())) return input.trim();

  // URL format
  const urlMatch = input.match(/spotify\.com\/artist\/([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];

  // URI format
  const uriMatch = input.match(/spotify:artist:([a-zA-Z0-9]{22})/);
  if (uriMatch) return uriMatch[1];

  return null;
}

// Get a Spotify access token using client credentials
async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

// Fetch public artist data from Spotify
export async function fetchSpotifyArtist(artistId: string): Promise<SpotifyArtistData | null> {
  const token = await getSpotifyToken();
  if (!token) return null;

  const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;
  const data = await res.json();

  return {
    followers: data.followers?.total || 0,
    popularity_score: data.popularity || 0,
    name: data.name || '',
    images: data.images || [],
    genres: data.genres || [],
  };
}


// ---- YouTube (Data API v3 — API key only) ----

interface YouTubeChannelData {
  subscribers: number;
  total_views: number;
  videos_count: number;
  name: string;
  thumbnail: string;
}

// Extract YouTube channel ID from various URL formats
// Supports: /channel/UC..., /@handle, /c/customname
export function extractYouTubeChannelInfo(input: string): { type: 'id' | 'handle' | 'custom'; value: string } | null {
  const trimmed = input.trim();

  // Direct channel ID (starts with UC, 24 chars)
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(trimmed)) return { type: 'id', value: trimmed };

  // @handle format
  const handleMatch = trimmed.match(/@([a-zA-Z0-9._-]+)/);
  if (handleMatch) return { type: 'handle', value: `@${handleMatch[1]}` };

  // URL with /channel/UC...
  const channelMatch = trimmed.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/);
  if (channelMatch) return { type: 'id', value: channelMatch[1] };

  // URL with /@handle
  const urlHandleMatch = trimmed.match(/youtube\.com\/@([a-zA-Z0-9._-]+)/);
  if (urlHandleMatch) return { type: 'handle', value: `@${urlHandleMatch[1]}` };

  // URL with /c/customname
  const customMatch = trimmed.match(/youtube\.com\/c\/([a-zA-Z0-9._-]+)/);
  if (customMatch) return { type: 'custom', value: customMatch[1] };

  return null;
}

// Resolve a YouTube handle or custom name to a channel ID
async function resolveYouTubeChannelId(info: { type: 'id' | 'handle' | 'custom'; value: string }): Promise<string | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  if (info.type === 'id') return info.value;

  // Search for the channel by handle or custom URL
  const searchParam = info.type === 'handle' ? `forHandle=${encodeURIComponent(info.value)}` : `forUsername=${encodeURIComponent(info.value)}`;
  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&${searchParam}&key=${apiKey}`);

  if (!res.ok) {
    // Fallback: try search API
    const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(info.value)}&type=channel&maxResults=1&key=${apiKey}`);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    return searchData.items?.[0]?.snippet?.channelId || null;
  }

  const data = await res.json();
  return data.items?.[0]?.id || null;
}

// Fetch public channel stats from YouTube
export async function fetchYouTubeChannel(input: string): Promise<(YouTubeChannelData & { channelId: string }) | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  const info = extractYouTubeChannelInfo(input);
  if (!info) return null;

  const channelId = await resolveYouTubeChannelId(info);
  if (!channelId) return null;

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${channelId}&key=${apiKey}`
  );

  if (!res.ok) return null;
  const data = await res.json();
  const channel = data.items?.[0];
  if (!channel) return null;

  return {
    channelId,
    subscribers: parseInt(channel.statistics?.subscriberCount || '0'),
    total_views: parseInt(channel.statistics?.viewCount || '0'),
    videos_count: parseInt(channel.statistics?.videoCount || '0'),
    name: channel.snippet?.title || '',
    thumbnail: channel.snippet?.thumbnails?.default?.url || '',
  };
}
