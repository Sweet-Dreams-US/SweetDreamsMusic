-- ============================================================
-- Fix booking table columns to match webhook INSERT
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add columns that the webhook needs but don't exist yet
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS night_fees_amount INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS same_day_fee BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS actual_deposit_paid INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS requested_engineer TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
