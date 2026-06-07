-- Migration 071: brand_settings — per-tenant brand identity (name, contact,
-- address) so a white-label studio can set its own without code. Singleton,
-- mirrors reward_settings. Seeded from the BRAND constant (byte-identical).
-- SITE_URL stays env-first (deploy concern), not stored here.

CREATE TABLE IF NOT EXISTS public.brand_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,                          -- NULL = default tenant
  name TEXT NOT NULL DEFAULT 'Sweet Dreams Music',
  legal_name TEXT NOT NULL DEFAULT 'Sweet Dreams LLC',
  tagline TEXT NOT NULL DEFAULT 'Fort Wayne Recording Studio',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT 'info@sweetdreamsmusic.com',
  addr_street TEXT NOT NULL DEFAULT '',
  addr_city TEXT NOT NULL DEFAULT 'Fort Wayne',
  addr_state TEXT NOT NULL DEFAULT 'IN',
  addr_zip TEXT NOT NULL DEFAULT '',
  addr_country TEXT NOT NULL DEFAULT 'US',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS brand_settings_studio_idx
  ON public.brand_settings (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid));

DROP TRIGGER IF EXISTS brand_settings_updated_at ON public.brand_settings;
CREATE TRIGGER brand_settings_updated_at BEFORE UPDATE ON public.brand_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Public read (brand name/contact appear on every public page + SEO); admin writes.
ALTER TABLE public.brand_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brand_settings_public_read ON public.brand_settings;
CREATE POLICY brand_settings_public_read ON public.brand_settings FOR SELECT USING (true);

INSERT INTO public.brand_settings (studio_id) VALUES (NULL)
ON CONFLICT (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

COMMENT ON TABLE public.brand_settings IS 'Per-tenant brand identity (name/contact/address). Seeded from the BRAND constant. Migration 071.';
