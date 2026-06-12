-- 041_band_setup_minutes.sql
--
-- Band sessions need a free setup hour before the metered time starts —
-- bands load gear, mic the drums, run line checks, etc. We pad the
-- conflict window upstream of start_time by N minutes so a 4hr band
-- session at 6pm actually blocks 5pm-10pm in the studio calendar.
--
-- Customers don't pay for the setup hour; pricing in lib/constants.ts
-- (BAND_PRICING) covers only the metered hours. The free pad is
-- recorded here so the conflict-detection layer in lib/utils.ts and
-- the engineer dashboard render the correct blocked window.
--
-- Default 0 keeps existing studio sessions unchanged. Band-booking
-- inserts set this to BAND_SETUP_MINUTES (60) at row creation time.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-applying on already-
-- migrated environments is a no-op.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS setup_minutes_before INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN bookings.setup_minutes_before IS
  'Free setup-time padding before start_time. Used by band sessions for gear load-in. Conflict checks subtract this many minutes from start_time when computing the blocked window.';
