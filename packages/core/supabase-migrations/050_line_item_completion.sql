-- 050_line_item_completion.sql
--
-- Round 8e: production status moves from media_bookings.component_status
-- (JSONB keyed by offering slot key) to first-class columns on each
-- line item.
--
-- approval_status (Round 8c) tracks scope agreement.
-- completion + Drive URL (this migration) track delivery.
-- Orthogonal axes — approved & in-progress can hold simultaneously.
--
-- Idempotent.

ALTER TABLE media_booking_line_items
  ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS drive_url TEXT,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS media_booking_line_items_completed_idx
  ON media_booking_line_items (completed) WHERE completed = TRUE;
