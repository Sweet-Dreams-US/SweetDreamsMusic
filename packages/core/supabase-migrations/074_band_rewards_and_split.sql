-- 074: Band rewards (free_sweet_spot) + band engineer pay split + band eligibility.
--
-- All additive / nullable. PAYROLL STAYS FROZEN: the band split only feeds the
-- engineer_split_pct SNAPSHOT stamped at completion of FUTURE band sessions.
-- computeEarningsCore is deliberately NOT made band-aware — historical band rows
-- keep their stamped split (or fall back to the constant 60% solo split), so the
-- payroll golden stays byte-identical. New columns default to "inherit", so there
-- is zero behavior change until the engine reads them.

-- 1. Allow the new free_sweet_spot reward type (mirror migration 073's widen).
ALTER TABLE reward_rules DROP CONSTRAINT IF EXISTS reward_rules_reward_type_check;
ALTER TABLE reward_rules ADD CONSTRAINT reward_rules_reward_type_check CHECK (
  reward_type = ANY (ARRAY[
    'free_hours','free_short_video','free_music_video','free_photo_session',
    'free_cutdowns','bundled_cutdowns','mv_discount_pct','spend_discount_pct',
    'referral_discount_pct','account_credit_cents','cash_bonus','cash_per_hour',
    'beat_lease_discount_pct','beat_exclusive_discount_pct',
    'free_sweet_spot',
    'status','perk'
  ])
);

-- 2. Allow a 'sweet_spot' media credit kind so free_sweet_spot can issue a credit.
ALTER TABLE media_credits DROP CONSTRAINT IF EXISTS media_credits_credit_kind_check;
ALTER TABLE media_credits ADD CONSTRAINT media_credits_credit_kind_check CHECK (
  credit_kind = ANY (ARRAY[
    'short_video','music_video','photo_session','cover_art',
    'marketing_session','planning_call','studio_hours','sweet_spot','other'
  ])
);

-- 3. Band engineer pay split (studio default). NULL = inherit the solo split.
ALTER TABLE revenue_settings ADD COLUMN IF NOT EXISTS engineer_band_session_pct NUMERIC(5,2);
ALTER TABLE revenue_settings DROP CONSTRAINT IF EXISTS revenue_band_pct_bounds;
ALTER TABLE revenue_settings ADD CONSTRAINT revenue_band_pct_bounds CHECK (
  engineer_band_session_pct IS NULL
  OR (engineer_band_session_pct >= 0 AND engineer_band_session_pct <= 100)
);

-- 4. Per-engineer band split override (NULL = inherit band default) + band eligibility.
ALTER TABLE engineers ADD COLUMN IF NOT EXISTS band_session_split_pct NUMERIC(5,2);
ALTER TABLE engineers DROP CONSTRAINT IF EXISTS engineers_band_session_split_pct_check;
ALTER TABLE engineers ADD CONSTRAINT engineers_band_session_split_pct_check CHECK (
  band_session_split_pct IS NULL
  OR (band_session_split_pct >= 0 AND band_session_split_pct <= 100)
);
ALTER TABLE engineers ADD COLUMN IF NOT EXISTS can_book_bands BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Keep bands working: Iszac stays band-eligible. Set the studio band split to 70%.
UPDATE engineers SET can_book_bands = TRUE WHERE display_name ILIKE '%iszac%' OR name ILIKE '%iszac%';
UPDATE revenue_settings SET engineer_band_session_pct = 70.00 WHERE studio_id IS NULL;
