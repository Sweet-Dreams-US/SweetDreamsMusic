-- Migration 062: enforce SECURITY DEFINER on every signup-chain trigger.
--
-- WHY THIS MIGRATION EXISTS
-- Migration 061 fixed the immediate incident (trg_profiles_create_sweet_dreams_thread
-- was missing SECURITY DEFINER → broke every signup once handle_new_user
-- stopped swallowing errors). This migration makes the same mistake
-- impossible to make again by adding a DDL-time guard:
--
--   • A registry table lists the tables in the signup cascade
--     (currently profiles, message_threads, message_thread_participants).
--     New cascade points can be added with a single INSERT.
--
--   • An audit function inspects every non-internal INSERT trigger on
--     a watched table and returns rows for the ones that aren't
--     SECURITY DEFINER. Returns 0 rows when healthy.
--
--   • An event trigger fires after CREATE TRIGGER / CREATE OR REPLACE
--     FUNCTION / ALTER FUNCTION / ALTER TRIGGER and runs the audit.
--     If new violations exist, it raises — which rolls back the DDL.
--     A future engineer trying to add a non-SECURITY-DEFINER trigger
--     to profiles will see their migration fail with a precise message
--     instead of breaking signup in production weeks later.
--
-- WHY ONLY INSERT TRIGGERS
-- The signup chain is pure INSERT → INSERT → INSERT. UPDATE / DELETE
-- triggers on watched tables (e.g. update_profiles_updated_at) don't
-- run during signup and don't need SECURITY DEFINER — they execute
-- under the user's own role, which has RLS-checked grants.
--
-- ESCAPE HATCH
-- If a future engineer is intentionally adding a non-SECURITY-DEFINER
-- INSERT trigger (e.g. for a test, or a feature where they want the
-- caller's permissions to apply), they can `ALTER EVENT TRIGGER
-- tg_enforce_signup_chain DISABLE` for the duration of the migration
-- and re-enable after. This must be deliberate, with a comment in the
-- migration explaining why — exactly the conversation we want forced.

-- ── Registry of watched tables ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signup_chain_watched_tables (
  table_name TEXT PRIMARY KEY,
  rationale  TEXT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.signup_chain_watched_tables (table_name, rationale) VALUES
  ('profiles',                      'Primary cascade target — handle_new_user inserts here on every signup.'),
  ('message_threads',               'Cascaded into by trg_profiles_create_sweet_dreams_thread.'),
  ('message_thread_participants',   'Cascaded into by trg_profiles_create_sweet_dreams_thread.')
ON CONFLICT DO NOTHING;

REVOKE ALL ON public.signup_chain_watched_tables FROM anon, authenticated;
GRANT  SELECT ON public.signup_chain_watched_tables TO postgres, service_role;
COMMENT ON TABLE public.signup_chain_watched_tables IS
  'Tables whose INSERT triggers must be SECURITY DEFINER (migration 062). Append rows here when a new feature cascades into another table from a signup-time trigger.';

-- ── Audit function — returns violations (0 rows = healthy) ──────────
CREATE OR REPLACE FUNCTION public.audit_signup_chain_triggers()
RETURNS TABLE (
  table_name    TEXT,
  trigger_name  TEXT,
  function_name TEXT,
  fix_hint      TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    n.nspname || '.' || c.relname AS table_name,
    t.tgname                       AS trigger_name,
    p.proname                      AS function_name,
    format(
      'Add SECURITY DEFINER (and SET search_path = public, pg_temp) to public.%I — see migration 061.',
      p.proname
    ) AS fix_hint
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND p.prosecdef = false
    -- Only INSERT triggers — those are the ones that fire during signup.
    -- bit 4 in tgtype = INSERT.
    AND (t.tgtype & 4) = 4
    AND c.relname IN (SELECT t2.table_name FROM public.signup_chain_watched_tables t2);
$$;

REVOKE ALL ON FUNCTION public.audit_signup_chain_triggers() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.audit_signup_chain_triggers() TO postgres, service_role;
COMMENT ON FUNCTION public.audit_signup_chain_triggers IS
  'Lists every non-SECURITY-DEFINER INSERT trigger on a signup_chain_watched_tables row. Returns 0 rows when healthy. Used by the event trigger below + the scripts/check-signup-chain.ts CI gate.';

-- ── Event trigger — rejects DDL that would introduce a violation ────
CREATE OR REPLACE FUNCTION public.enforce_signup_chain_security_definer()
RETURNS event_trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v RECORD;
  msg TEXT := '';
BEGIN
  FOR v IN SELECT * FROM public.audit_signup_chain_triggers() LOOP
    msg := msg || format(
      E'\n  • %s on %s uses public.%I — %s',
      v.trigger_name, v.table_name, v.function_name, v.fix_hint
    );
  END LOOP;

  IF msg <> '' THEN
    RAISE EXCEPTION
      'Signup-chain trigger guard rejected DDL. The following INSERT triggers on watched tables are NOT SECURITY DEFINER, which would break new-user signup under supabase_auth_admin:%

To intentionally bypass (rarely correct), run inside the same migration:
  ALTER EVENT TRIGGER tg_enforce_signup_chain DISABLE;
  -- ...your DDL...
  ALTER EVENT TRIGGER tg_enforce_signup_chain ENABLE;
See migration 061 for the incident this guard prevents.', msg;
  END IF;
END
$function$;

DROP EVENT TRIGGER IF EXISTS tg_enforce_signup_chain;

CREATE EVENT TRIGGER tg_enforce_signup_chain
  ON ddl_command_end
  WHEN TAG IN (
    'CREATE TRIGGER',
    'ALTER TRIGGER',
    'CREATE FUNCTION',
    'ALTER FUNCTION'
  )
  EXECUTE FUNCTION public.enforce_signup_chain_security_definer();

COMMENT ON FUNCTION public.enforce_signup_chain_security_definer IS
  'Event-trigger handler that runs the signup-chain audit after CREATE/ALTER TRIGGER and CREATE/ALTER FUNCTION DDL. Rolls back the transaction if it would leave a non-SECURITY-DEFINER INSERT trigger on a watched table.';

-- ── Self-test — confirms current state is healthy after migration 061 ──
DO $$
DECLARE
  hits INT;
BEGIN
  SELECT COUNT(*) INTO hits FROM public.audit_signup_chain_triggers();
  IF hits > 0 THEN
    RAISE EXCEPTION 'Migration 062 self-test failed: % existing trigger(s) violate the rule before the event trigger is installed. Apply migration 061 first.', hits;
  END IF;
END $$;
