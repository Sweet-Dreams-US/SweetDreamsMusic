-- 086: Whitelabel W0 — brand_settings grows the fields SEO + email identity
-- need so NOTHING brand-shaped lives in code. ADDITIVE + INERT: live code
-- (main) never reads these columns; only the whitelabel branch does. Seeded
-- with the exact current hardcoded values so the branch's output is
-- byte-identical for Sweet Dreams (proven by scripts/seo-golden.ts).

ALTER TABLE public.brand_settings ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.brand_settings ADD COLUMN IF NOT EXISTS from_email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.brand_settings ADD COLUMN IF NOT EXISTS from_name TEXT NOT NULL DEFAULT '';

UPDATE public.brand_settings SET
  socials = '{
    "instagram": "https://www.instagram.com/sweetdreamsmusic",
    "youtube": "https://www.youtube.com/@sweetdreamsmusic",
    "tiktok": "https://www.tiktok.com/@sweetdreamsmusic"
  }'::jsonb,
  from_email = 'studio@sweetdreamsmusic.com',
  from_name = 'Sweet Dreams Music'
WHERE studio_id IS NULL AND from_email = '';
