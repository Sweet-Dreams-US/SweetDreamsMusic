-- 046_cash_ledger_xor_check.sql
--
-- Belt-and-suspenders for the cash_ledger XOR invariant. Migration 045
-- added cash_ledger.media_booking_id; the application layer enforces
-- "exactly one of (booking_id, media_booking_id) is set" but a CHECK
-- constraint makes it impossible for a future code change to violate
-- the invariant by accident.
--
-- "Both NULL" is also rejected because a ledger row with no source
-- attribution would show up in payouts as ghost cash.
--
-- Idempotent: drops the constraint first if it exists, then re-adds.
-- This pattern lets us evolve the constraint later without manual
-- DB surgery.

ALTER TABLE cash_ledger
  DROP CONSTRAINT IF EXISTS cash_ledger_source_xor;

ALTER TABLE cash_ledger
  ADD CONSTRAINT cash_ledger_source_xor CHECK (
    (booking_id IS NOT NULL AND media_booking_id IS NULL) OR
    (booking_id IS NULL AND media_booking_id IS NOT NULL)
  ) NOT VALID;

-- NOT VALID first so existing rows aren't re-validated (they all pass
-- per migration 045's smoke test, but NOT VALID makes the deploy
-- guaranteed instant — no full table scan). Then VALIDATE in a separate
-- statement so the constraint is enforced on future writes.
ALTER TABLE cash_ledger
  VALIDATE CONSTRAINT cash_ledger_source_xor;

COMMENT ON CONSTRAINT cash_ledger_source_xor ON cash_ledger IS
  'XOR: exactly one of (booking_id, media_booking_id) must be set per ledger row. Defensive layer matching the application-level enforcement.';
