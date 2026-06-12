-- ============================================================
-- 016: Engineer Priority Rework
-- Dynamic priority windows, accept/pass, artist reschedule
-- ============================================================

-- Track whether the requested engineer explicitly passed
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS engineer_passed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS engineer_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority_reminder_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reschedule_deadline TIMESTAMPTZ;

-- Index for the priority-expiry cron to find bookings needing reminder
CREATE INDEX IF NOT EXISTS idx_bookings_priority_reminder
  ON bookings (priority_expires_at, priority_reminder_sent, engineer_name)
  WHERE priority_reminder_sent = FALSE AND engineer_name IS NULL;
