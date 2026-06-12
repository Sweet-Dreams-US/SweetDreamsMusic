-- 013: Invite system improvements
-- Add artist_name to bookings for tracking stage names
-- Add reminder_sent flag to prevent duplicate reminders
-- Add created_by_email to track which engineer created the booking

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS artist_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by_email TEXT;

-- Index for the cron job to find upcoming sessions needing reminders
CREATE INDEX IF NOT EXISTS idx_bookings_reminder
  ON bookings (start_time, status, reminder_sent)
  WHERE status = 'confirmed' AND reminder_sent = FALSE;
