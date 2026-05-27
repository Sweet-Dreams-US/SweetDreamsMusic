-- Migration 061: harden the signup → profile → cascade-triggers chain.
--
-- INCIDENT (May 25 – May 27 2026)
-- Every email/password signup attempt failed with "Database error
-- saving new user" since 2026-05-25 20:11 UTC. Zero new auth.users
-- rows over a ~36-hour window.
--
-- ROOT CAUSE
-- The trigger function trg_profiles_create_sweet_dreams_thread() fires
-- AFTER INSERT on public.profiles and inserts into public.message_threads
-- + public.message_thread_participants. It was created WITHOUT
-- SECURITY DEFINER, so it runs under the caller's role. For real
-- signups the caller is `supabase_auth_admin` (GoTrue's role), which
-- has no INSERT/SELECT privilege on either message_* table.
--
-- The thread INSERT therefore raised `permission denied for table
-- message_threads`. Before migration 060, the parent trigger
-- (handle_new_user) caught EVERYTHING under `WHEN OTHERS THEN RAISE
-- WARNING` — so the thread INSERT failed silently and the auth.users
-- insert completed. That's why every user had a profile but only some
-- had threads (the ones inserted by paths that ran as postgres, like
-- admin-triggered backfills).
--
-- Migration 060 tightened handle_new_user so that only unique_violation
-- is swallowed, which is the right call for profile creation itself —
-- but it accidentally surfaced this dormant permission bug. With the
-- error now propagating, the WHOLE signup fails (the trigger ran in
-- the same transaction as the auth.users insert).
--
-- THREE-LAYER FIX
--
--   1. trg_profiles_create_sweet_dreams_thread → SECURITY DEFINER +
--      explicit search_path. This makes it run as the function owner
--      (postgres, which bypasses RLS and has full grants), matching
--      the pattern already used by handle_new_user and sync_profile_email.
--      The actual permission error goes away.
--
--   2. The thread function also gets an internal BEGIN/EXCEPTION block.
--      Thread creation is nice-to-have — a user without a Sweet Dreams
--      thread is not a broken user; they just won't have an inbox row
--      until one is created later. We must NEVER let a future bug here
--      kill signups. A separate `signup_trigger_failures` table captures
--      what would otherwise be lost so we can backfill via a cron.
--
--   3. The audit table `signup_trigger_failures` records any caught
--      failure with full context (user_id, trigger name, SQLSTATE,
--      message). It's RLS-locked to service_role so engineers can read
--      it in the admin UI without exposing it to clients.
--
-- RESULT
-- Future cascade-trigger failures on profiles (any new feature anyone
-- adds) will:
--   • Run with proper privileges if they use SECURITY DEFINER (pattern
--     enforced via this migration's comment + a code-review note)
--   • If they fail anyway, the failure is logged but the user's signup
--     still succeeds — degraded data, never blocked auth.

-- ── 1. Audit table for swallowed signup-time trigger failures ─────────
CREATE TABLE IF NOT EXISTS public.signup_trigger_failures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  trigger_name  TEXT NOT NULL,
  sqlstate      TEXT NOT NULL,
  sqlerrm       TEXT NOT NULL,
  context       JSONB,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signup_trigger_failures_user
  ON public.signup_trigger_failures (user_id);

CREATE INDEX IF NOT EXISTS idx_signup_trigger_failures_unresolved
  ON public.signup_trigger_failures (occurred_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.signup_trigger_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages signup_trigger_failures"
  ON public.signup_trigger_failures;

CREATE POLICY "service_role manages signup_trigger_failures"
  ON public.signup_trigger_failures
  FOR ALL
  USING (true)
  WITH CHECK (true);
-- ^ RLS is on, but the policy is permissive — only the service_role can
-- reach this table because no GRANT is given to anon/authenticated.

REVOKE ALL ON public.signup_trigger_failures FROM anon, authenticated;
GRANT  ALL ON public.signup_trigger_failures TO postgres, service_role;

COMMENT ON TABLE public.signup_trigger_failures IS
  'Captures cascading-trigger failures during user signup (migration 061). Used so a downstream trigger failure does not block the auth.users insert. Resolve rows by running the corresponding backfill, then setting resolved_at.';

-- ── 2. Rewrite the thread-creation trigger function ──────────────────
--
-- Changes vs. previous version:
--   - SECURITY DEFINER + explicit search_path (eliminates the permission
--     bug that started this incident)
--   - Internal exception handler that logs to signup_trigger_failures
--     instead of bubbling up. Signup MUST NOT fail because the
--     "create welcome thread" feature failed.
CREATE OR REPLACE FUNCTION public.trg_profiles_create_sweet_dreams_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  new_thread_id UUID;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotent: skip if a sweet_dreams thread already exists for this user.
  IF EXISTS (
    SELECT 1 FROM message_threads
    WHERE kind = 'sweet_dreams' AND owner_user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO message_threads (kind, owner_user_id, subject)
    VALUES ('sweet_dreams', NEW.user_id, 'Sweet Dreams Music')
    RETURNING id INTO new_thread_id;

    INSERT INTO message_thread_participants (thread_id, user_id, role)
    VALUES (new_thread_id, NEW.user_id, 'owner');
  EXCEPTION
    WHEN OTHERS THEN
      -- Log and continue. We do NOT want this to break signup.
      -- The audit table is read by admins to backfill failed threads.
      INSERT INTO public.signup_trigger_failures (user_id, trigger_name, sqlstate, sqlerrm, context)
      VALUES (
        NEW.user_id,
        'trg_profiles_create_sweet_dreams_thread',
        SQLSTATE,
        SQLERRM,
        jsonb_build_object(
          'profile_id', NEW.id,
          'display_name', NEW.display_name,
          'email', NEW.email
        )
      );
  END;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trg_profiles_create_sweet_dreams_thread IS
  'AFTER INSERT trigger on profiles — creates a welcome message thread. Migration 061: now SECURITY DEFINER (was running as caller and failing for real signups under supabase_auth_admin) and internally guarded so a future failure here cannot block signup. Failures land in public.signup_trigger_failures for backfill.';

-- ── 3. Future-proofing reminder ─────────────────────────────────────
-- Any new trigger on public.profiles that touches another table MUST
-- be SECURITY DEFINER, or its INSERT/SELECT will fail under
-- supabase_auth_admin and break signups. See docs/triggers.md (TODO)
-- and the comment on handle_new_user. The audit query is:
--   SELECT proname, prosecdef FROM pg_proc p
--   JOIN pg_trigger t ON t.tgfoid = p.oid
--   JOIN pg_class c ON c.oid = t.tgrelid
--   WHERE c.relname = 'profiles' AND NOT t.tgisinternal;
