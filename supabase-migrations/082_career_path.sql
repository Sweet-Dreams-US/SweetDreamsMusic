-- 082: Career Development Path (Plan 6) — gated career engine reading real
-- app usage. Two tracks: Career Stages (computed from requirements, replaces
-- the free-text profiles.career_stage) + Listener Tiers (permanent, verified
-- snapshots only). Plus rollout scoring, private listening links, contacts.
--
-- House patterns: additive only; RLS own-rows for artist-facing tables;
-- token/share tables are SERVICE-ROLE ONLY (zero client policies — all access
-- through routes); enums live in code (lib/career.ts), no CHECK on rule keys.

-- ── 1. Requirement catalog (seeded by scripts/seed-career-requirements.ts) ───
CREATE TABLE IF NOT EXISTS public.career_stage_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 5),
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  verify_type TEXT NOT NULL CHECK (verify_type IN ('auto','semi','confirm','playbook')),
  rule JSONB NOT NULL DEFAULT '{}'::jsonb,           -- machine spec for auto/semi checks
  confirm_fields JSONB,                              -- structured prompts for confirm type
  playbook_section TEXT,                             -- roadmap section id (playbook type)
  xp_award INTEGER NOT NULL DEFAULT 10,
  sort INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.career_stage_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS career_reqs_read ON public.career_stage_requirements;
CREATE POLICY career_reqs_read ON public.career_stage_requirements
  FOR SELECT TO authenticated USING (true);          -- catalog is not secret

-- ── 2. Per-user requirement progress ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.requirement_progress (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL REFERENCES public.career_stage_requirements(key) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete')),
  completed_at TIMESTAMPTZ,
  evidence JSONB,                                    -- confirm answers / photo url / auto snapshot ref
  PRIMARY KEY (user_id, requirement_key)
);
ALTER TABLE public.requirement_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS req_progress_own_read ON public.requirement_progress;
CREATE POLICY req_progress_own_read ON public.requirement_progress
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- writes: service role only (gate evaluation + confirm routes)

-- ── 3. Shows (semi-verified: calendar event must predate the show) ──────────
CREATE TABLE IF NOT EXISTS public.shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue TEXT NOT NULL,
  city TEXT,
  show_date DATE NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  is_headline BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_event_id UUID REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,                          -- post-show confirmation timestamp
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shows_user_idx ON public.shows (user_id, show_date);
ALTER TABLE public.shows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shows_own ON public.shows;
CREATE POLICY shows_own ON public.shows
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 4. Networking contacts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.artist_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  handle TEXT,
  role TEXT NOT NULL DEFAULT 'other' CHECK (role IN ('artist','producer','videographer','designer','fan','other')),
  email TEXT,                                        -- fed by listen-page feedback one-click add
  met_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',             -- 'manual' | 'listen_feedback'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS artist_contacts_user_idx ON public.artist_contacts (user_id);
ALTER TABLE public.artist_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artist_contacts_own ON public.artist_contacts;
CREATE POLICY artist_contacts_own ON public.artist_contacts
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 5. Project collaborators (on-platform = verified) ───────────────────────
CREATE TABLE IF NOT EXISTS public.project_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.artist_projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = off-platform
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'feature',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS project_collaborators_project_idx ON public.project_collaborators (project_id);
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_collaborators_owner ON public.project_collaborators;
CREATE POLICY project_collaborators_owner ON public.project_collaborators
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artist_projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.artist_projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

-- ── 6. Listener tiers (permanent certifications — never deleted) ────────────
CREATE TABLE IF NOT EXISTS public.listener_tiers (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL CHECK (tier IN (10000,50000,100000,200000,500000,1000000,2000000,5000000,10000000)),
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_snapshot_id UUID REFERENCES public.artist_metrics(id) ON DELETE SET NULL,
  second_snapshot_id UUID REFERENCES public.artist_metrics(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, tier)
);
ALTER TABLE public.listener_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listener_tiers_read ON public.listener_tiers;
CREATE POLICY listener_tiers_read ON public.listener_tiers
  FOR SELECT TO authenticated USING (true);          -- badges are public flex by design
-- writes: service role only (the tier cron)

-- ── 7. Private listening links + feedback ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.track_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- the sharing artist
  project_id UUID REFERENCES public.artist_projects(id) ON DELETE SET NULL,
  deliverable_id UUID,                               -- deliverables.id (file in client-audio-files)
  track_label TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS track_share_links_token_idx ON public.track_share_links (token);
CREATE INDEX IF NOT EXISTS track_share_links_user_idx ON public.track_share_links (user_id);
ALTER TABLE public.track_share_links ENABLE ROW LEVEL SECURITY;   -- zero policies: routes only

CREATE TABLE IF NOT EXISTS public.track_share_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id UUID NOT NULL REFERENCES public.track_share_links(id) ON DELETE CASCADE,
  listener_name TEXT NOT NULL,
  listener_email TEXT NOT NULL,
  vibe_score INTEGER NOT NULL CHECK (vibe_score BETWEEN 1 AND 10),
  favorite_moment_seconds INTEGER,
  comment TEXT,
  added_to_contacts BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS track_share_feedback_link_idx ON public.track_share_feedback (share_link_id);
ALTER TABLE public.track_share_feedback ENABLE ROW LEVEL SECURITY; -- zero policies: routes only

-- ── 8. Rollout fields on artist_projects ────────────────────────────────────
-- (cover art reuses the EXISTING cover_image_url; release date reuses
--  target_release_date; released detection = current_phase='released')
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS presave_url TEXT;
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS ad_budget_cents INTEGER;
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS rollout_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS rollout_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS release_date_set_at TIMESTAMPTZ; -- when target_release_date was (re)set — for the 21-day item
ALTER TABLE public.artist_projects ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS artist_projects_slug_idx ON public.artist_projects (slug) WHERE slug IS NOT NULL;

-- Media bookings can link to a project (rollout: photoshoot/video booked).
ALTER TABLE public.media_bookings ADD COLUMN IF NOT EXISTS linked_project_id UUID REFERENCES public.artist_projects(id) ON DELETE SET NULL;

-- Goals can auto-sync from verified snapshots (streaming/social categories).
ALTER TABLE public.artist_goals ADD COLUMN IF NOT EXISTS linked_platform TEXT;
ALTER TABLE public.artist_goals ADD COLUMN IF NOT EXISTS auto_synced_at TIMESTAMPTZ;
