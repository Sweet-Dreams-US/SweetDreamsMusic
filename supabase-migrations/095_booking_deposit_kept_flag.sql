-- 095_booking_deposit_kept_flag.sql
-- Explicit "kept deposit" flag for cancelled bookings.
--
-- Before: the accounting "Kept Deposits" figure summed actual_deposit_paid across
-- ALL cancelled bookings — i.e. it assumed every cancelled booking's deposit was
-- kept. In reality most cancellations are refunded, so the figure was inflated
-- (and inflated Business Keeps + the P&L). Now keeping a deposit is a deliberate
-- admin action via a "Keep Deposit" button; only flagged deposits count.
--
-- Defaults to false so nothing is retroactively counted as kept — admins mark the
-- ones they actually kept.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_kept boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_kept_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_kept_by text;

COMMENT ON COLUMN bookings.deposit_kept IS 'True when an admin explicitly kept this cancelled booking''s deposit (vs refunded it). Drives the accounting Kept Deposits figure.';
