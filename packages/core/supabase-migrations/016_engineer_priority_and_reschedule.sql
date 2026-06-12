-- ============================================================
-- 016: Engineer Priority Window & Reschedule Requests
-- Requested engineers get a 2-hour head start to claim sessions
-- Artists can request reschedule if assigned engineer isn't preferred
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS priority_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority_notified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reschedule_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reschedule_reason TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_priority_expiry
  ON bookings (priority_expires_at, priority_notified)
  WHERE priority_expires_at IS NOT NULL AND priority_notified = FALSE;
