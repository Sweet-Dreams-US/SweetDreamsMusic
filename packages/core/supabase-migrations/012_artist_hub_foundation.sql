-- ============================================================
-- Artist Hub Foundation Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. PROFILES: Add artist fields
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'career_stage'
  ) THEN
    ALTER TABLE profiles ADD COLUMN career_stage TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'genre'
  ) THEN
    ALTER TABLE profiles ADD COLUMN genre TEXT;
  END IF;
END $$;

-- ============================================================
-- 2. ARTIST PROJECTS (active workflow tracker)
-- ============================================================
CREATE TABLE IF NOT EXISTS artist_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'single',
  description TEXT,
  cover_image_url TEXT,
  genre TEXT,
  target_release_date DATE,
  current_phase TEXT NOT NULL DEFAULT 'concept',
  status TEXT NOT NULL DEFAULT 'active',
  streaming_links JSONB DEFAULT '{}'::jsonb,
  featured_artists TEXT[] DEFAULT '{}',
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE artist_projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own projects" ON artist_projects
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create projects" ON artist_projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own projects" ON artist_projects
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own projects" ON artist_projects
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Public projects viewable by anyone (for profile display)
DO $$ BEGIN
  CREATE POLICY "Public projects viewable by anyone" ON artist_projects
    FOR SELECT USING (is_public = true AND status = 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3. PROJECT TASKS (per-phase checklists)
-- ============================================================
CREATE TABLE IF NOT EXISTS artist_project_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES artist_projects(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  title TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE artist_project_tasks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage own project tasks" ON artist_project_tasks
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM artist_projects
        WHERE artist_projects.id = artist_project_tasks.project_id
        AND artist_projects.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. SESSION NOTES (engineer → artist)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  engineer_id UUID NOT NULL REFERENCES auth.users(id),
  engineer_name TEXT NOT NULL,
  content TEXT NOT NULL,
  what_was_worked_on TEXT,
  next_steps TEXT,
  linked_project_id UUID REFERENCES artist_projects(id) ON DELETE SET NULL,
  is_visible_to_client BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE session_notes ENABLE ROW LEVEL SECURITY;

-- Engineers can manage their own notes
DO $$ BEGIN
  CREATE POLICY "Engineers can manage own notes" ON session_notes
    FOR ALL USING (auth.uid() = engineer_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Clients can view visible notes on their bookings
DO $$ BEGIN
  CREATE POLICY "Clients can view visible session notes" ON session_notes
    FOR SELECT USING (
      is_visible_to_client = true
      AND EXISTS (
        SELECT 1 FROM bookings
        WHERE bookings.id = session_notes.booking_id
        AND bookings.customer_email = (
          SELECT email FROM auth.users WHERE id = auth.uid()
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 5. ARTIST GOALS
-- ============================================================
CREATE TABLE IF NOT EXISTS artist_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  target_value NUMERIC,
  current_value NUMERIC DEFAULT 0,
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE artist_goals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage own goals" ON artist_goals
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 6. ARTIST METRICS (manual weekly logging)
-- ============================================================
CREATE TABLE IF NOT EXISTS artist_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  platform TEXT NOT NULL,
  followers INTEGER,
  streams INTEGER,
  engagement_rate NUMERIC,
  monthly_listeners INTEGER,
  subscribers INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, metric_date, platform)
);

ALTER TABLE artist_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage own metrics" ON artist_metrics
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 7. CALENDAR EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'other',
  event_date DATE NOT NULL,
  event_time TIME,
  description TEXT,
  color TEXT,
  linked_project_id UUID REFERENCES artist_projects(id) ON DELETE SET NULL,
  is_auto_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage own calendar events" ON calendar_events
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 8. ARTIST ACHIEVEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS artist_achievements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, achievement_key)
);

ALTER TABLE artist_achievements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own achievements" ON artist_achievements
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 9. BOOKINGS: Link to projects
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'linked_project_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN linked_project_id UUID REFERENCES artist_projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 10. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_artist_projects_user_id ON artist_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_artist_projects_status ON artist_projects(status);
CREATE INDEX IF NOT EXISTS idx_artist_project_tasks_project_id ON artist_project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_session_notes_booking_id ON session_notes(booking_id);
CREATE INDEX IF NOT EXISTS idx_artist_goals_user_id ON artist_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_artist_metrics_user_id ON artist_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_artist_metrics_date ON artist_metrics(metric_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_artist_achievements_user_id ON artist_achievements(user_id);
