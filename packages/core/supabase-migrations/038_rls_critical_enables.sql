-- Migration 038: Enable RLS on tables that had it disabled in production.
--
-- Context: the Supabase advisor flagged 6 tables sitting in the `public` schema
-- (therefore exposed to PostgREST / the anon client) with RLS disabled. That is
-- a real hole — any of these could be read or written by an unauthenticated
-- browser session.
--
-- What we verified before writing this:
--   • contact_submissions, testimonials, portfolio_projects are UNUSED in the
--     app code. They're leftovers. Enable RLS; their existing public policies
--     stay in place (stale but harmless after RLS kicks in).
--   • admin_users, admin_broadcasts, cash_events are ONLY touched via
--     createServiceClient() from server-side admin routes. The service_role
--     bypasses RLS, so enabling it here just locks out anon / authenticated.
--     No code paths depend on those roles reaching these tables.
--
-- This migration is idempotent via IF-style guards. Running it twice is a
-- no-op.

-- Stale tables with pre-existing public policies — enable RLS to enforce them.
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_projects  ENABLE ROW LEVEL SECURITY;

-- Admin-only tables. No policies = anon/authenticated locked out entirely.
-- Service role bypasses RLS, so admin routes that use createServiceClient()
-- continue to work unchanged.
ALTER TABLE public.admin_users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_broadcasts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_events       ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: add explicit service_role policies so the intent is
-- obvious in pg_policies listings and advisor output. These are no-ops
-- functionally (service_role already bypasses RLS) but they document the
-- access pattern for the next person reading this schema.
DROP POLICY IF EXISTS "Service role full access" ON public.admin_users;
CREATE POLICY "Service role full access" ON public.admin_users
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.admin_broadcasts;
CREATE POLICY "Service role full access" ON public.admin_broadcasts
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.cash_events;
CREATE POLICY "Service role full access" ON public.cash_events
  TO service_role USING (true) WITH CHECK (true);
