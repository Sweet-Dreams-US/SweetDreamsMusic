-- ============================================================
-- 063: Booking deposit_method
-- Marks how a booking's deposit is intended to be paid:
--   'card' (default) — client pays the deposit online via Stripe
--   'cash'           — client/engineer intends a cash deposit;
--                      the slot is held only once the engineer
--                      records the cash (status flips to confirmed).
-- Additive + defaulted so every existing row becomes 'card'.
-- Nothing reads it as required; no backfill script needed.
-- ============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS deposit_method TEXT NOT NULL DEFAULT 'card';
