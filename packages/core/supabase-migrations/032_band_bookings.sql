-- ============================================================
-- Phase 3 — Band sessions on the booking flow
-- ============================================================
-- Adds `band_id` to `bookings`. The booker remains the paying customer
-- (customer_email still drives Stripe + emails + XP); `band_id` is the
-- informational tag that says "this session is for Band X" so the engineer
-- dashboard and analytics can group sessions by band.
--
-- ON DELETE SET NULL: if a band is ever deleted, historical bookings must
-- survive (the session happened; payment was taken). The row just loses its
-- band attribution. Don't cascade — that would be destructive.
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS band_id UUID REFERENCES bands(id) ON DELETE SET NULL;

COMMENT ON COLUMN bookings.band_id IS
  'Optional — if set, the booking is attributed to this band. The booker (customer_email) is still the paying customer; band_id is purely informational for grouping sessions by band.';

-- Partial index — only non-null band_ids take space. Powers the common query
-- "show me all sessions for this band".
CREATE INDEX IF NOT EXISTS idx_bookings_band_id
  ON bookings(band_id) WHERE band_id IS NOT NULL;
