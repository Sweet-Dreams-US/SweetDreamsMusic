-- 088: brand_settings.review_url — the Google-review CTA target in the
-- files-delivered email. Additive + inert on main; seeded with the exact
-- hardcoded literal so whitelabel-branch reads are byte-identical.
ALTER TABLE public.brand_settings ADD COLUMN IF NOT EXISTS review_url TEXT;
UPDATE public.brand_settings
  SET review_url = COALESCE(review_url, 'https://g.page/r/CcWAY0XlIQNpEBM/review')
  WHERE studio_id IS NULL;
