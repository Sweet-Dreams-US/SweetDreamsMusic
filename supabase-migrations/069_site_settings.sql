-- Migration 069: site_settings — per-tenant feature flags + nav/page visibility.
-- The data layer for the white-label "Studio Control Panel". One row per tenant
-- (studio_id NULL = the default Sweet Dreams tenant). Mirrors reward_settings (066).
--
-- LOCKED features (studio_sessions = /book,/pricing  and  beats = /beats,/sell-beats)
-- are deliberately NOT columns here — they are enforced as always-on in code
-- (lib/site-settings.ts clamp + the API EDITABLE allow-list). There is no DB
-- representation that can disable them, so a tampered PATCH has nothing to write.
--
-- SAFETY: additive only. Nothing reads these flags until the Phase-2 cutover.
-- Missing row / missing column → code treats the feature as ON (fail-open).

CREATE TABLE IF NOT EXISTS public.site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,                          -- NULL = default tenant (forward-looking, like 066/068)

  -- Toggleable FEATURES (whole sections). Default ON.
  bands_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  events_enabled  BOOLEAN NOT NULL DEFAULT TRUE,   -- ON + "encouraged" (nudge lives in the UI)
  media_enabled   BOOLEAN NOT NULL DEFAULT TRUE,

  -- Toggleable NAV / marketing PAGES (visibility). Default ON.
  nav_about_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  nav_contact_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  nav_engineers_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  nav_blog_enabled      BOOLEAN NOT NULL DEFAULT TRUE,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per tenant; COALESCE the nullable studio_id to a sentinel (same idiom
-- as reward_settings_studio_idx in 066).
CREATE UNIQUE INDEX IF NOT EXISTS site_settings_studio_idx
  ON public.site_settings (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Reuse the shared trigger fn (migration 039, used by 066/068).
DROP TRIGGER IF EXISTS site_settings_updated_at ON public.site_settings;
CREATE TRIGGER site_settings_updated_at BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Public read (the Header/Footer render flags for anonymous visitors on every
-- public page). Writes go through the service role (admin panel). Same posture
-- as site_content / studio_rooms in 068.
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_settings_public_read ON public.site_settings;
CREATE POLICY site_settings_public_read ON public.site_settings FOR SELECT USING (true);

-- Seed the default row: everything ON (events ON + encouraged-by-default).
INSERT INTO public.site_settings (studio_id) VALUES (NULL)
ON CONFLICT (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

COMMENT ON TABLE public.site_settings IS
  'Per-tenant feature flags + nav/page visibility (the Studio Control Panel). studio_sessions + beats are NOT here — locked ON in code. Migration 069.';
