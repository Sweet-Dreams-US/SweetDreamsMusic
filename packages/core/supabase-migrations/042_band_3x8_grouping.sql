-- 042_band_3x8_grouping.sql
--
-- The 3×8 band block is THREE separate bookings rows (one per day) so
-- the calendar/conflict logic treats each day independently. But for
-- accounting, payouts, and "this is one project" UI grouping, we want
-- them to share an identity. booking_group_id is that shared UUID.
--
-- All three rows share the same booking_group_id. The first row carries
-- setup_minutes_before=60 (gear loads in once on day 1); days 2-3
-- have setup_minutes_before=0 since the studio is already on hold.
--
-- sweet_spot_addon is JSONB because the bundle pricing varies by
-- session length (standalone $2,500 / 8hr add-on $2,000 / 3×8 add-on
-- $1,000) and we want to capture which tier was chosen. Stored on
-- the parent band booking row, not duplicated per day.
--
-- Idempotent.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_group_id UUID,
  ADD COLUMN IF NOT EXISTS sweet_spot_addon JSONB;

-- Index only the rows that have a group, since the vast majority of
-- bookings are single sessions with NULL booking_group_id.
CREATE INDEX IF NOT EXISTS bookings_group_idx
  ON bookings (booking_group_id)
  WHERE booking_group_id IS NOT NULL;

COMMENT ON COLUMN bookings.booking_group_id IS
  'Shared UUID across multi-day band booking rows (e.g. 3×8). NULL for single-day sessions.';
COMMENT ON COLUMN bookings.sweet_spot_addon IS
  'Snapshot of Sweet Spot filming add-on chosen at checkout. Shape: { tier: "standalone"|"addOnTo8hrSession"|"addOnTo3DayFull", price_cents: int }';
