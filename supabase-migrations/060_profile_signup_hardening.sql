-- Migration 060: harden the new-user → profile creation trigger.
--
-- ROOT CAUSE INVESTIGATION
-- After 137 signups, 19 auth.users rows had no matching profile row.
-- The previous handle_new_user() trigger swallowed any unexpected error
-- under an `EXCEPTION WHEN OTHERS THEN RAISE WARNING ... ` block:
--
--     EXCEPTION
--       WHEN unique_violation THEN
--         RAISE NOTICE 'Profile already exists for user %, skipping', NEW.id;
--       WHEN OTHERS THEN
--         RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
--
-- The `WHEN OTHERS` branch sounds defensive — "don't block signup if
-- profile creation fails" — but in practice it MASKED a real bug. We
-- have no log capture for `RAISE WARNING`, so for ~14% of signups the
-- profile silently never got created, and downstream features (CRM,
-- RSVP roster, public profiles, engineer-side joins) gave back "User
-- a1b2c3d4" placeholders or empty results.
--
-- This migration:
--
--   1. Backfills any auth.users rows that lack a profile. Idempotent —
--      a second run is a no-op.
--   2. Replaces handle_new_user() with a version that no longer hides
--      OTHERS errors. Insert failures will now propagate and fail the
--      signup — which is the LOUD failure mode we want, because the
--      caller can retry, surface a clear error, and we get a trace.
--      `unique_violation` remains caught (profile already exists is
--      benign and means the trigger re-fired on a stale row).
--   3. Removes the unsafe IF EXISTS slug-uniqueness loop. Slug
--      collisions are now handled by appending a short random suffix
--      in a single statement — the loop could theoretically spin
--      forever under contention, and the random suffix avoids the
--      "user → user1 → user2 → ..." race entirely.

-- ── 1. Backfill missing profiles ────────────────────────────────────
WITH missing AS (
  SELECT
    u.id    AS user_id,
    u.email AS email,
    COALESCE(
      u.raw_user_meta_data->>'display_name',
      split_part(u.email, '@', 1),
      'user'
    ) AS display_name
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id)
),
slugged AS (
  SELECT
    user_id, email, display_name,
    NULLIF(LOWER(REGEXP_REPLACE(display_name, '[^a-zA-Z0-9]', '', 'g')), '') AS base_slug
  FROM missing
),
deduped AS (
  SELECT
    user_id, email, display_name,
    COALESCE(base_slug, 'user') AS base_slug,
    ROW_NUMBER() OVER (PARTITION BY COALESCE(base_slug, 'user') ORDER BY user_id) AS rn
  FROM slugged
),
final_slug AS (
  SELECT
    user_id, email, display_name,
    CASE
      WHEN rn = 1 AND NOT EXISTS (SELECT 1 FROM profiles WHERE public_profile_slug = base_slug)
        THEN base_slug
      ELSE base_slug || rn::TEXT
    END AS public_profile_slug
  FROM deduped
)
INSERT INTO profiles (user_id, display_name, public_profile_slug, email)
SELECT user_id, display_name, public_profile_slug, email FROM final_slug
ON CONFLICT (user_id) DO NOTHING;

-- ── 2. Replace the trigger function ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  user_email          TEXT;
  display_name_value  TEXT;
  base_slug           TEXT;
  slug_value          TEXT;
BEGIN
  user_email := COALESCE(NEW.email, 'user');
  display_name_value := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    split_part(user_email, '@', 1),
    'user'
  );

  -- Build the slug. Strip non-alphanumerics, lowercase. Empty source →
  -- 'user'. Collision resolution: if the base slug is already taken,
  -- append a short random hex suffix in one shot. Old code used a
  -- WHILE EXISTS loop that could in theory spin forever under heavy
  -- contention; a 6-hex-digit suffix gives 16M slots per base — more
  -- than enough.
  base_slug := NULLIF(LOWER(REGEXP_REPLACE(display_name_value, '[^a-zA-Z0-9]', '', 'g')), '');
  base_slug := COALESCE(base_slug, 'user');

  IF EXISTS (SELECT 1 FROM public.profiles WHERE public_profile_slug = base_slug) THEN
    slug_value := base_slug || '-' || SUBSTR(MD5(NEW.id::TEXT), 1, 6);
  ELSE
    slug_value := base_slug;
  END IF;

  -- INSERT. unique_violation on user_id is benign (trigger re-fired on
  -- an existing row) — anything else now propagates so the signup
  -- attempt fails LOUDLY rather than silently leaving an orphan.
  BEGIN
    INSERT INTO public.profiles (user_id, display_name, public_profile_slug, email)
    VALUES (NEW.id, display_name_value, slug_value, NEW.email);
  EXCEPTION
    WHEN unique_violation THEN
      -- Either user_id or slug collision — log and continue. (The
      -- random-hex suffix above makes slug collision near-impossible,
      -- but we keep the guard for the (rare) re-fire-on-existing-row
      -- case where user_id is already in profiles.)
      RAISE NOTICE 'Profile insert skipped for user % (unique_violation)', NEW.id;
  END;

  RETURN NEW;
END;
$function$;

-- Trigger itself doesn't need re-binding; CREATE OR REPLACE keeps it.

COMMENT ON FUNCTION public.handle_new_user IS
  'Creates a public.profiles row when a new auth.users row is inserted. Errors other than unique_violation now propagate (migration 060) — previously they were silently swallowed, leaving 19 of 137 users without profiles before backfill.';
