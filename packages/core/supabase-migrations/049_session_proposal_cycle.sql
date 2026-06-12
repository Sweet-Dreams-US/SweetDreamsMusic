-- 049_session_proposal_cycle.sql
--
-- Round 8d: extend media_session_bookings for per-line-item scheduling
-- with a back-and-forth proposal cycle.
--
-- Buyer proposes first; admin approves or counter-proposes (which creates
-- a new row pointing at the original via supersedes_id). Once both sides
-- agree, status flips to 'scheduled' (existing meaning preserved).
--
-- Idempotent. Safe to re-run.

ALTER TABLE media_session_bookings
  ADD COLUMN IF NOT EXISTS line_item_id UUID
    REFERENCES media_booking_line_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposed_by TEXT
    CHECK (proposed_by IS NULL OR proposed_by IN ('admin', 'buyer')),
  ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supersedes_id UUID
    REFERENCES media_session_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS media_session_bookings_line_item_idx
  ON media_session_bookings (line_item_id) WHERE line_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_session_bookings_supersedes_idx
  ON media_session_bookings (supersedes_id) WHERE supersedes_id IS NOT NULL;

ALTER TABLE media_session_bookings
  DROP CONSTRAINT IF EXISTS media_session_bookings_status_check;
ALTER TABLE media_session_bookings
  ADD CONSTRAINT media_session_bookings_status_check
  CHECK (status IN ('proposed', 'scheduled', 'in_progress', 'completed', 'cancelled', 'superseded'));

ALTER TABLE media_session_bookings
  DROP CONSTRAINT IF EXISTS media_session_bookings_session_kind_check;
ALTER TABLE media_session_bookings
  ADD CONSTRAINT media_session_bookings_session_kind_check
  CHECK (session_kind IN (
    'video', 'photo', 'recording', 'mixing', 'storyboard', 'marketing-meeting',
    'planning_call', 'filming_external', 'design_meeting', 'mixing_session',
    'recording_session', 'photo_shoot', 'other'
  ));

ALTER TABLE media_session_bookings
  ALTER COLUMN engineer_id DROP NOT NULL;
