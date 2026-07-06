-- 087: brand_settings sub-brands + geo + analytics (whitelabel W0 completion).
-- Additive + INERT on main (main's brandFromRow ignores unknown columns).
-- Seeds carry the EXACT literals the code hardcodes today, so the whitelabel
-- branch's brand-driven reads stay byte-identical for Sweet Dreams.

ALTER TABLE public.brand_settings
  ADD COLUMN IF NOT EXISTS store_name TEXT,
  ADD COLUMN IF NOT EXISTS media_name TEXT,
  ADD COLUMN IF NOT EXISTS ga_id TEXT,
  ADD COLUMN IF NOT EXISTS geo_lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS geo_lng NUMERIC(9,6);

UPDATE public.brand_settings SET
  store_name = COALESCE(store_name, 'Sweet Dreams Beat Store'),
  media_name = COALESCE(media_name, 'Sweet Dreams Media'),
  ga_id      = COALESCE(ga_id, 'G-85S88F3K6K'),
  geo_lat    = COALESCE(geo_lat, 41.0793),
  geo_lng    = COALESCE(geo_lng, -85.1394)
WHERE studio_id IS NULL;
