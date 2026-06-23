-- supabase-migrations/092_charge_on_accept.sql
-- Phase 2: charge-on-accept foundation. ADDITIVE + idempotent — existing bookings
-- keep their current statuses and behavior untouched. These columns + the two new
-- states govern only NEW self-serve bookings: the customer's card is SAVED at
-- booking (no charge), and the deposit is charged when an ENGINEER accepts. If the
-- saved-card charge fails twice, the booking goes to 'payment_pending' and the
-- customer gets a repayment link.

-- ── New columns ──────────────────────────────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,          -- card-on-file customer
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,    -- saved PM to charge on accept
  ADD COLUMN IF NOT EXISTS repayment_token TEXT,             -- token for the "engineer confirmed, payment failed → repay" link
  ADD COLUMN IF NOT EXISTS slot_hold_expires_at TIMESTAMPTZ, -- soft slot hold while payment_pending
  ADD COLUMN IF NOT EXISTS charge_attempts INTEGER NOT NULL DEFAULT 0, -- off-session charge tries (failsafe after 2)
  ADD COLUMN IF NOT EXISTS charged_at TIMESTAMPTZ;           -- when the deposit was actually captured

-- Sparse unique index: only payment_pending bookings carry a repayment token.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_repayment_token
  ON bookings (repayment_token) WHERE repayment_token IS NOT NULL;

-- Fast availability lookups: which bookings currently hold a slot.
CREATE INDEX IF NOT EXISTS idx_bookings_status_starttime
  ON bookings (status, start_time);

-- ── Widen the status vocabulary ──────────────────────────────────────
-- 'requested'        : card on file, UNPAID, awaiting an engineer, slot NOT held
--                      (first-come-first-serve until an engineer accepts + charges).
-- 'payment_pending'  : an engineer accepted but the saved-card charge failed twice;
--                      NOT on the calendar — awaiting the customer's repayment link.
-- The new CHECK is a strict superset of the old one, so every existing row stays valid.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS valid_booking_status;
ALTER TABLE bookings ADD CONSTRAINT valid_booking_status
  CHECK (status = ANY (ARRAY[
    'requested'::text,
    'pending'::text,
    'pending_approval'::text,
    'pending_deposit'::text,
    'approved'::text,
    'confirmed'::text,
    'payment_pending'::text,
    'completed'::text,
    'cancelled'::text,
    'rejected'::text,
    'deleted'::text
  ]));
