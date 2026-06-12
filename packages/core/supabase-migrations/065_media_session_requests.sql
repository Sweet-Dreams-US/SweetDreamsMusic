-- Migration 065: media session REQUEST + CONFIRM loop (artist ↔ media team)
--
-- Brings the media side to parity with the engineer flow. An artist with a
-- media_credit (Phase 2 ledger) schedules a shoot: picks a date/time (≥48h
-- out) and types their VISION — no studio-room pick, no videographer pick.
-- That creates a media_session_bookings row with status='requested'. The
-- media team (role='media_manager') sees the shared queue, then Accepts
-- (atomic claim → status='scheduled', stamps the manager) or reschedules /
-- declines. Mirrors bookings.respond for engineers.
--
-- All columns are additive + nullable, so existing media_session_bookings
-- rows (the offering/package/proposal flow) are untouched.

-- ── media_session_bookings: request/confirm fields ──────────────────
ALTER TABLE media_session_bookings
  ADD COLUMN IF NOT EXISTS vision            TEXT,
  ADD COLUMN IF NOT EXISTS media_credit_id   UUID REFERENCES media_credits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS media_manager_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at      TIMESTAMPTZ;

-- engineer_id is irrelevant to a media request (no videographer picked at
-- request time). It was made nullable in an earlier round; ensure it.
ALTER TABLE media_session_bookings ALTER COLUMN engineer_id DROP NOT NULL;

-- parent_booking_id nullable — future comp/manual credits may have no source
-- order. Requests set it to the credit's source_booking_id when present.
ALTER TABLE media_session_bookings ALTER COLUMN parent_booking_id DROP NOT NULL;

-- Add 'requested' to the status CHECK (drop + recreate; keeps all prior values).
ALTER TABLE media_session_bookings DROP CONSTRAINT IF EXISTS media_session_bookings_status_check;
ALTER TABLE media_session_bookings ADD CONSTRAINT media_session_bookings_status_check
  CHECK (status = ANY (ARRAY[
    'requested','proposed','scheduled','in_progress','completed','cancelled','superseded'
  ]));

CREATE INDEX IF NOT EXISTS idx_msb_manager_time
  ON media_session_bookings (media_manager_id, starts_at)
  WHERE media_manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msb_credit
  ON media_session_bookings (media_credit_id)
  WHERE media_credit_id IS NOT NULL;
-- Shared "incoming requests" queue: unclaimed requests, soonest first.
CREATE INDEX IF NOT EXISTS idx_msb_unclaimed_requests
  ON media_session_bookings (starts_at)
  WHERE media_manager_id IS NULL AND status = 'requested';

COMMENT ON COLUMN media_session_bookings.vision IS 'Artist''s free-text vision/goals/inspiration for the shoot (request flow, migration 065). Shown prominently to the media team for planning.';
COMMENT ON COLUMN media_session_bookings.media_manager_id IS 'The media_manager (auth.users.id) who claimed/confirmed this job. NULL = unclaimed request.';

-- ── media_session_bookings RLS: shared media-team read queue ────────
-- API routes read via the service role (bypasses RLS) after
-- verifyMediaManagerAccess, so this policy is defense-in-depth: any
-- media_manager or admin may read every media session (shared team queue).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='media_session_bookings'
      AND policyname='media_team_reads_all_sessions'
  ) THEN
    CREATE POLICY media_team_reads_all_sessions
      ON media_session_bookings FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.user_id = auth.uid() AND p.role IN ('media_manager','admin')
        )
      );
  END IF;
END $$;

-- ── media_bookings: OPTIONAL salesperson + commission on a job ──────
-- When someone (e.g. an engineer) sells a media job, log them + a sales %
-- for payroll. Self-booked / media-manager-booked jobs leave these NULL.
-- sales_commission_cents is the frozen snapshot taken when the job's cost
-- is finalized (mirror package_entitlements.sales_commission_cents,
-- migration 058) so payroll stays correct even if the total later changes.
ALTER TABLE media_bookings
  ADD COLUMN IF NOT EXISTS salesperson_name       TEXT,
  ADD COLUMN IF NOT EXISTS sales_commission_pct   NUMERIC(5,2) CHECK (sales_commission_pct IS NULL OR (sales_commission_pct >= 0 AND sales_commission_pct <= 100)),
  ADD COLUMN IF NOT EXISTS sales_commission_cents INTEGER;

COMMENT ON COLUMN media_bookings.salesperson_name IS 'Optional: who sold this media job (payroll commission). NULL for self-booked / media-manager-booked jobs.';
COMMENT ON COLUMN media_bookings.sales_commission_cents IS 'Frozen commission snapshot in cents, stamped when the job cost is finalized.';
