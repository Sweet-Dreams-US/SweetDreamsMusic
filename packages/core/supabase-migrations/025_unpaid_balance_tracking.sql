-- Add guest tracking and payment reminder fields to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_count INTEGER DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_fee_amount INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reminder_sent BOOLEAN DEFAULT false;

-- Index for finding unpaid completed sessions (used by cron + booking validation)
CREATE INDEX IF NOT EXISTS idx_bookings_unpaid_completed
  ON bookings (customer_email, status, remainder_amount)
  WHERE status = 'completed' AND remainder_amount > 0;
