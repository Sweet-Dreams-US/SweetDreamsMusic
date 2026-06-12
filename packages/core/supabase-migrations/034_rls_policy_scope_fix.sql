-- ============================================================
-- Migration 034 — Tighten RLS policy scope on bands + events tables.
--
-- Problem: migrations 031 and 033 created policies of the form:
--   CREATE POLICY "..." ON <table> FOR ALL USING (true) WITH CHECK (true);
--
-- Without a `TO <role>` clause, Postgres applies the policy to EVERY role —
-- including `anon` and `authenticated` — which means any client holding
-- NEXT_PUBLIC_SUPABASE_ANON_KEY could technically read/write these tables
-- directly, bypassing the app layer.
--
-- Fix: drop the overly-permissive policies and recreate them scoped to
-- `service_role` only. The app's service client (lib/supabase/server.ts) is
-- the only code path that should touch these tables anyway — all current
-- access goes through API routes and server-only lib files (verified).
--
-- After this migration, anon and authenticated clients have ZERO access to
-- these tables via RLS (which is correct — all access flows through the
-- service role). If a future feature needs client-direct reads, add a
-- narrower policy scoped to `authenticated` USING a real predicate.
-- ============================================================

-- ── Bands (originally migration 031) ────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on bands"         ON bands;
DROP POLICY IF EXISTS "Service role full access on band_members"  ON band_members;
DROP POLICY IF EXISTS "Service role full access on band_invites"  ON band_invites;

CREATE POLICY "service_role full access on bands"
  ON bands FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on band_members"
  ON band_members FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on band_invites"
  ON band_invites FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Events (originally migration 033) ───────────────────────────────
DROP POLICY IF EXISTS "Service role full access on events"        ON events;
DROP POLICY IF EXISTS "Service role full access on event_rsvps"   ON event_rsvps;

CREATE POLICY "service_role full access on events"
  ON events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on event_rsvps"
  ON event_rsvps FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Studio blocks (originally migration 009, same pattern) ──────────
-- Double-check and re-scope if the original policy exists in the same shape.
DROP POLICY IF EXISTS "Service role full access"          ON studio_blocks;
DROP POLICY IF EXISTS "Service role full access on studio_blocks" ON studio_blocks;

CREATE POLICY "service_role full access on studio_blocks"
  ON studio_blocks FOR ALL TO service_role USING (true) WITH CHECK (true);
