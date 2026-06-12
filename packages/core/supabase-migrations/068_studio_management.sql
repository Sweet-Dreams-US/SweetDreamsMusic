-- Migration 068: studio management — make rooms/pricing/hours/engineers/content
-- DB-driven (today hardcoded in lib/constants). Onboarding a white-label studio
-- becomes pure data setup, no code. Design:
-- docs/superpowers/specs/2026-06-06-studio-management-system-design.md
--
-- NAMING: a white-label `studios` table already exists (the TENANT/LOCATION — slug
-- 'sweet-dreams'). A bookable room (studio_a/studio_b) is a `studio_rooms` row that
-- belongs to a location via location_id. So: studios = business/location (tenant),
-- studio_rooms = the bookable spaces inside it.
--
-- SAFETY: additive only. Nothing reads these tables until the engine cutover (P3).
-- `bookings.room` stays a slug referencing studio_rooms.slug, so the 100+ existing
-- ROOM_LABELS[room] lookups + historical bookings keep working. Seeded from the
-- current constants (lib/studio-config seedStudiosFromConstants) → byte-identical.

-- ───────────────────────── studio_rooms ─────────────────────────
CREATE TABLE IF NOT EXISTS public.studio_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.studios(id) ON DELETE CASCADE,  -- the tenant (white-label)
  slug TEXT NOT NULL UNIQUE,                  -- 'studio_a' — bookings.room references this
  display_name TEXT NOT NULL,                 -- 'Studio A'
  description TEXT,
  hero_image_url TEXT,
  gallery JSONB NOT NULL DEFAULT '[]'::jsonb,

  hourly_rate_cents INTEGER NOT NULL,
  single_hour_rate_cents INTEGER NOT NULL,
  deposit_percent INTEGER NOT NULL DEFAULT 50,
  min_hours NUMERIC NOT NULL DEFAULT 1,
  max_hours NUMERIC NOT NULL DEFAULT 8,

  free_guests INTEGER NOT NULL DEFAULT 3,
  guest_fee_cents INTEGER NOT NULL DEFAULT 1000,
  max_guests INTEGER NOT NULL DEFAULT 12,

  weekday_start_hour NUMERIC,                 -- 18.5 = Mon-Fri after 6:30 PM (NULL = always)
  open_hour NUMERIC NOT NULL DEFAULT 0,
  close_hour NUMERIC NOT NULL DEFAULT 24,
  same_day_buffer_hours INTEGER NOT NULL DEFAULT 3,

  band_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS studio_rooms_active_idx ON public.studio_rooms(active, sort_order);
CREATE INDEX IF NOT EXISTS studio_rooms_location_idx ON public.studio_rooms(location_id);

-- ───────────────────── studio_room_pricing_tiers ─────────────────────
CREATE TABLE IF NOT EXISTS public.studio_room_pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.studio_rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                         -- 'sweet_4' | 'band_4h' | 'band_8h' | 'band_24h'
  hours NUMERIC NOT NULL,
  price_cents INTEGER NOT NULL,
  per_hour_cents INTEGER,
  label TEXT,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, kind)
);

-- ───────────────────── studio_room_surcharges ─────────────────────
-- Time-window surcharges. room_id NULL = global default (applies to all rooms).
CREATE TABLE IF NOT EXISTS public.studio_room_surcharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.studio_rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('late_night','deep_night','same_day')),
  start_hour NUMERIC,
  end_hour NUMERIC,
  amount_cents INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (room_id, kind)   -- idempotent global rows (PG15+)
);
CREATE INDEX IF NOT EXISTS studio_room_surcharges_room_idx ON public.studio_room_surcharges(room_id);

-- ───────────────────────── engineers ─────────────────────────
-- DB-driven roster (replaces the ENGINEERS constant). EMAIL is the immutable
-- identity payroll keys off (the Zion-rename lesson).
CREATE TABLE IF NOT EXISTS public.engineers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.studios(id) ON DELETE CASCADE,  -- the tenant
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,                         -- canonical payroll name
  display_name TEXT NOT NULL,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  photo_url TEXT,
  bio TEXT,
  user_id UUID,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.studio_room_engineers (
  room_id UUID NOT NULL REFERENCES public.studio_rooms(id) ON DELETE CASCADE,
  engineer_id UUID NOT NULL REFERENCES public.engineers(id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, engineer_id)
);

-- ───────────────────────── site_content (CMS) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.site_content (
  key TEXT PRIMARY KEY,                       -- 'home.hero.title', 'about.body', ...
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_name TEXT,
  label TEXT,
  kind TEXT NOT NULL DEFAULT 'text',          -- 'text' | 'richtext' | 'image' | 'list' | 'number'
  location_id UUID REFERENCES public.studios(id) ON DELETE CASCADE,  -- per-tenant content
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS site_content_group_idx ON public.site_content(group_name);

-- ───────────────────────── triggers ─────────────────────────
DROP TRIGGER IF EXISTS studio_rooms_updated_at ON public.studio_rooms;
CREATE TRIGGER studio_rooms_updated_at BEFORE UPDATE ON public.studio_rooms FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS studio_room_pricing_tiers_updated_at ON public.studio_room_pricing_tiers;
CREATE TRIGGER studio_room_pricing_tiers_updated_at BEFORE UPDATE ON public.studio_room_pricing_tiers FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS studio_room_surcharges_updated_at ON public.studio_room_surcharges;
CREATE TRIGGER studio_room_surcharges_updated_at BEFORE UPDATE ON public.studio_room_surcharges FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS engineers_updated_at ON public.engineers;
CREATE TRIGGER engineers_updated_at BEFORE UPDATE ON public.engineers FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS site_content_updated_at ON public.site_content;
CREATE TRIGGER site_content_updated_at BEFORE UPDATE ON public.site_content FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ───────────────────────── RLS ─────────────────────────
ALTER TABLE public.studio_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_rooms_public_read ON public.studio_rooms;
CREATE POLICY studio_rooms_public_read ON public.studio_rooms FOR SELECT USING (true);
ALTER TABLE public.studio_room_pricing_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_room_pricing_tiers_public_read ON public.studio_room_pricing_tiers;
CREATE POLICY studio_room_pricing_tiers_public_read ON public.studio_room_pricing_tiers FOR SELECT USING (true);
ALTER TABLE public.studio_room_surcharges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_room_surcharges_public_read ON public.studio_room_surcharges;
CREATE POLICY studio_room_surcharges_public_read ON public.studio_room_surcharges FOR SELECT USING (true);
ALTER TABLE public.engineers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS engineers_public_read ON public.engineers;
CREATE POLICY engineers_public_read ON public.engineers FOR SELECT USING (true);
ALTER TABLE public.studio_room_engineers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_room_engineers_public_read ON public.studio_room_engineers;
CREATE POLICY studio_room_engineers_public_read ON public.studio_room_engineers FOR SELECT USING (true);
ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_content_public_read ON public.site_content;
CREATE POLICY site_content_public_read ON public.site_content FOR SELECT USING (true);

COMMENT ON TABLE public.studio_rooms IS 'Bookable rooms (studio_a/studio_b) within a tenant location (studios). Pricing/hours/guest rules. bookings.room references slug. Migration 068.';
COMMENT ON TABLE public.engineers IS 'DB-driven engineer roster (replaces ENGINEERS constant). email = immutable payroll identity. Migration 068.';
COMMENT ON TABLE public.site_content IS 'CMS content blocks for public pages (keyed, per-tenant). Migration 068.';
