-- 040_media_session_reminder_flag.sql
-- Phase E follow-up: 1-hour-before reminder support for media sessions.
--
-- Adds `reminder_sent` boolean to `media_session_bookings`. The cron job
-- at /api/cron/session-reminders queries this flag the same way it does
-- on the existing `bookings` table — find rows starting in the 45–75
-- minute window, send the email, set the flag.
--
-- Default FALSE so every existing row gets reminded once (next time
-- it falls into the window). For rows already in the past, this is
-- harmless — the cron's time-window filter excludes them anyway.

ALTER TABLE media_session_bookings
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for the cron's filter — partial so we only index the rows
-- that still need reminding, keeping the index small.
CREATE INDEX IF NOT EXISTS media_session_bookings_pending_reminder_idx
  ON media_session_bookings (starts_at)
  WHERE reminder_sent = FALSE AND status = 'scheduled';
