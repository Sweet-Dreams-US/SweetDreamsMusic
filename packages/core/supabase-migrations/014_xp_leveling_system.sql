-- ============================================================
-- 014: XP & Leveling System + Hub Improvements
-- ============================================================

-- 1. XP fields on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_xp INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS artist_level INTEGER DEFAULT 1;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_streak INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_hub_visit DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0;

-- 2. XP Activity Log
CREATE TABLE IF NOT EXISTS xp_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  xp_amount INTEGER NOT NULL,
  label TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE xp_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own xp log" ON xp_log
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert own xp log" ON xp_log
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_xp_log_user_id ON xp_log(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_log_created_at ON xp_log(created_at);
CREATE INDEX IF NOT EXISTS idx_xp_log_action ON xp_log(action);

-- 3. Recurring calendar events support
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurring_rule TEXT; -- 'daily', 'weekly', 'biweekly', 'monthly'
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurring_end_date DATE;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS parent_event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE;

-- 4. Achievement insert policy (was read-only, need insert for auto-trigger)
DO $$ BEGIN
  CREATE POLICY "Users can insert own achievements" ON artist_achievements
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Session notes: allow artists to write notes too (not just engineers)
ALTER TABLE session_notes ALTER COLUMN engineer_id DROP NOT NULL;
ALTER TABLE session_notes ALTER COLUMN engineer_name DROP NOT NULL;
ALTER TABLE session_notes ADD COLUMN IF NOT EXISTS author_type TEXT DEFAULT 'engineer'; -- 'engineer' or 'artist'
ALTER TABLE session_notes ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES auth.users(id);

-- Artists can manage their own notes on their bookings
DO $$ BEGIN
  CREATE POLICY "Artists can manage own session notes" ON session_notes
    FOR ALL USING (auth.uid() = author_id AND author_type = 'artist');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
