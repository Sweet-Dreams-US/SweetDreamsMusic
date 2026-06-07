-- 072_confirmed_requires_engineer.sql
--
-- Rule: a studio session is "Confirmed" ONLY when an engineer has claimed it.
-- Deposit-paid-but-unclaimed is 'pending' (shown as "Awaiting Engineer").
-- Enforced in app code (lib/booking-status.ts: deposit → paidBookingStatus;
-- engineer claim flips to 'confirmed') AND here at the database as a hard floor.
--
-- APPLY ONLY AFTER the code that writes 'pending' for unclaimed paid bookings is
-- deployed — otherwise the old code's confirmed+null inserts would be rejected.
--
-- Step 1 (data): reclassify currently-'confirmed' bookings with NO engineer to
-- 'pending'. Under the old model 'confirmed' just meant 'paid', so these are
-- paid-but-unclaimed sessions that were mislabeled (incl. the recovered 9 AM
-- Studio B session). 'completed'/'cancelled' are untouched.
UPDATE bookings
SET status = 'pending'
WHERE status = 'confirmed' AND engineer_name IS NULL;

-- Step 2 (constraint): make 'confirmed without an engineer' impossible.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_confirmed_requires_engineer
  CHECK (status <> 'confirmed' OR engineer_name IS NOT NULL);
