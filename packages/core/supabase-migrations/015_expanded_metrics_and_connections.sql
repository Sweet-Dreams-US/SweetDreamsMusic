-- ============================================================
-- 015: Expanded Metrics & Platform Connections
-- Adds new metric columns, new platforms, and auto-fetch support
-- ============================================================

-- 1. Add new metric columns to artist_metrics
ALTER TABLE artist_metrics
  ADD COLUMN IF NOT EXISTS saves INTEGER,
  ADD COLUMN IF NOT EXISTS playlist_adds INTEGER,
  ADD COLUMN IF NOT EXISTS popularity_score INTEGER,
  ADD COLUMN IF NOT EXISTS plays INTEGER,
  ADD COLUMN IF NOT EXISTS shazams INTEGER,
  ADD COLUMN IF NOT EXISTS avg_likes INTEGER,
  ADD COLUMN IF NOT EXISTS avg_comments INTEGER,
  ADD COLUMN IF NOT EXISTS reels_views INTEGER,
  ADD COLUMN IF NOT EXISTS posts_count INTEGER,
  ADD COLUMN IF NOT EXISTS total_likes INTEGER,
  ADD COLUMN IF NOT EXISTS avg_views INTEGER,
  ADD COLUMN IF NOT EXISTS videos_count INTEGER,
  ADD COLUMN IF NOT EXISTS total_views BIGINT,
  ADD COLUMN IF NOT EXISTS watch_hours NUMERIC,
  ADD COLUMN IF NOT EXISTS reposts INTEGER,
  ADD COLUMN IF NOT EXISTS comments INTEGER,
  ADD COLUMN IF NOT EXISTS impressions INTEGER,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'; -- 'manual', 'spotify_api', 'youtube_api', etc.

-- 2. Platform connections table (store artist profile URLs/IDs for auto-fetch)
CREATE TABLE IF NOT EXISTS platform_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_id TEXT,           -- e.g., Spotify artist ID, YouTube channel ID
  platform_url TEXT,          -- Original URL pasted by artist
  display_name TEXT,          -- Name as it appears on platform
  profile_image_url TEXT,     -- Avatar from platform
  is_verified BOOLEAN DEFAULT FALSE,
  auto_fetch_enabled BOOLEAN DEFAULT TRUE,
  last_fetched_at TIMESTAMPTZ,
  fetch_error TEXT,           -- Last error message if fetch failed
  metadata JSONB DEFAULT '{}', -- Extra platform-specific data
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage own connections" ON platform_connections
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for cron job (find connections needing refresh)
CREATE INDEX IF NOT EXISTS idx_platform_connections_fetch
  ON platform_connections (platform, auto_fetch_enabled, last_fetched_at)
  WHERE auto_fetch_enabled = TRUE;

-- 3. Add indexes for new metric fields
CREATE INDEX IF NOT EXISTS idx_artist_metrics_source
  ON artist_metrics (source)
  WHERE source != 'manual';
