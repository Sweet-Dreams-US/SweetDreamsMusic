-- Migration 068: studio management — make studios/pricing/hours/engineers/content
-- DB-driven (today hardcoded in lib/constants). Onboarding a white-label studio
-- becomes pure data setup, no code. Design:
-- docs/superpowers/specs/2026-06-06-studio-management-system-design.md
--
-- SAFETY: additive only. Nothing reads these tables until the config layer is
-- wired (phased). `bookings.room` stays a slug referencing studios.slug, so the
-- 100+ existing ROOM_LABELS[room] lookups + historical bookings keep working.
-- Seeded from the current constants (see lib/studio-config seedStudiosFromConstants)
-- so day-one behavior is byte-identical (golden-tested).

-- ───────────────────────── studios ─────────────────────────
CREATE TABLE IF NOT EXISTS public.studios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,                 -- 'studio_a' — bookings.room references this
  display_name TEXT NOT NULL,                -- 'Studio A'
  description TEXT,
  hero_image_url TEXT,
  gallery JSONB NOT NULL DEFAULT '[]'::jsonb,

  hourly_rate_cents INTEGER NOT NULL,        -- 2+ hour rate
  single_hour_rate_cents INTEGER NOT NULL,   -- 1-hour rate
  deposit_percent INTEGER NOT NULL DEFAULT 50,
  min_hours NUMERIC NOT NULL DEFAULT 1,
  max_hours NUMERIC NOT NULL DEFAULT 8,

  free_guests INTEGER NOT NULL DEFAULT 3,
  guest_fee_cents INTEGER NOT NULL DEFAULT 1000,
  max_guests INTEGER NOT NULL DEFAULT 12,

  weekday_start_hour NUMERIC,                -- e.g. 18.5 = Mon-Fri after 6:30 PM (NULL = always)
  open_hour NUMERIC NOT NULL DEFAULT 0,
  close_hour NUMERIC NOT NULL DEFAULT 24,
  same_day_buffer_hours INTEGER NOT NULL DEFAULT 3,

  band_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  studio_id UUID,                            -- forward-looking: which LOCATION (white-label). NULL = default.
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS studios_active_idx ON public.studios(active, sort_order);

-- ───────────────────── studio_pricing_tiers ─────────────────────
CREATE TABLE IF NOT EXISTS public.studio_pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- 'sweet_4' | 'band_4h' | 'band_8h' | 'band_24h'
  hours NUMERIC NOT NULL,
  price_cents INTEGER NOT NULL,
  per_hour_cents INTEGER,
  label TEXT,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (studio_id, kind)
);

-- ───────────────────── studio_surcharges ─────────────────────
-- Time-window surcharges. studio_id NULL = global default (applies to all studios).
CREATE TABLE IF NOT EXISTS public.studio_surcharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES public.studios(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('late_night','deep_night','same_day')),
  start_hour NUMERIC,                        -- null for same_day (applies to all hours)
  end_hour NUMERIC,
  amount_cents INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per (studio, kind); NULLS NOT DISTINCT so global (NULL studio_id) rows
  -- also dedup by kind, making the seed idempotent (PG15+).
  UNIQUE NULLS NOT DISTINCT (studio_id, kind)
);
CREATE INDEX IF NOT EXISTS studio_surcharges_studio_idx ON public.studio_surcharges(studio_id);

-- ───────────────────────── engineers ─────────────────────────
-- DB-driven roster (replaces the ENGINEERS constant). EMAIL is the immutable
-- identity payroll keys off (the Zion-rename lesson) — name can change, email can't.
CREATE TABLE IF NOT EXISTS public.engineers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,                        -- canonical payroll name
  display_name TEXT NOT NULL,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  photo_url TEXT,
  bio TEXT,
  user_id UUID,                              -- links to auth.users when known
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.studio_engineers (
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  engineer_id UUID NOT NULL REFERENCES public.engineers(id) ON DELETE CASCADE,
  PRIMARY KEY (studio_id, engineer_id)
);

-- ───────────────────────── site_content (CMS) ─────────────────────────
-- Keyed editable content blocks for the public pages. value is typed per key
-- (string / rich text / image url / list of {label,...}).
CREATE TABLE IF NOT EXISTS public.site_content (
  key TEXT PRIMARY KEY,                      -- 'home.hero.title', 'about.body', 'footer.hours', ...
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_name TEXT,                           -- 'home' | 'about' | 'pricing' | ... for the editor UI
  label TEXT,                                -- human label for the editor
  kind TEXT NOT NULL DEFAULT 'text',         -- 'text' | 'richtext' | 'image' | 'list' | 'number'
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS site_content_group_idx ON public.site_content(group_name);

-- ───────────────────────── triggers ─────────────────────────
DROP TRIGGER IF EXISTS studios_updated_at ON public.studios;
CREATE TRIGGER studios_updated_at BEFORE UPDATE ON public.studios FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS studio_pricing_tiers_updated_at ON public.studio_pricing_tiers;
CREATE TRIGGER studio_pricing_tiers_updated_at BEFORE UPDATE ON public.studio_pricing_tiers FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS studio_surcharges_updated_at ON public.studio_surcharges;
CREATE TRIGGER studio_surcharges_updated_at BEFORE UPDATE ON public.studio_surcharges FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS engineers_updated_at ON public.engineers;
CREATE TRIGGER engineers_updated_at BEFORE UPDATE ON public.engineers FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS site_content_updated_at ON public.site_content;
CREATE TRIGGER site_content_updated_at BEFORE UPDATE ON public.site_content FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ───────────────────────── RLS ─────────────────────────
-- Public marketing data → readable by anyone (drives the public pages). Writes
-- go through the service role (admin managers).
ALTER TABLE public.studios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studios_public_read ON public.studios;
CREATE POLICY studios_public_read ON public.studios FOR SELECT USING (true);

ALTER TABLE public.studio_pricing_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_pricing_tiers_public_read ON public.studio_pricing_tiers;
CREATE POLICY studio_pricing_tiers_public_read ON public.studio_pricing_tiers FOR SELECT USING (true);

ALTER TABLE public.studio_surcharges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_surcharges_public_read ON public.studio_surcharges;
CREATE POLICY studio_surcharges_public_read ON public.studio_surcharges FOR SELECT USING (true);

ALTER TABLE public.engineers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS engineers_public_read ON public.engineers;
CREATE POLICY engineers_public_read ON public.engineers FOR SELECT USING (true);

ALTER TABLE public.studio_engineers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_engineers_public_read ON public.studio_engineers;
CREATE POLICY studio_engineers_public_read ON public.studio_engineers FOR SELECT USING (true);

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_content_public_read ON public.site_content;
CREATE POLICY site_content_public_read ON public.site_content FOR SELECT USING (true);

COMMENT ON TABLE public.studios IS 'Bookable studios/rooms — pricing/hours/guest rules. Replaces the hardcoded ROOMS/PRICING. bookings.room references slug. Migration 068.';
COMMENT ON TABLE public.engineers IS 'DB-driven engineer roster (replaces ENGINEERS constant). email = immutable payroll identity. Migration 068.';
COMMENT ON TABLE public.site_content IS 'CMS content blocks for public pages (keyed). Migration 068.';
