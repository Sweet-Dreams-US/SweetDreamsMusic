-- 057_beat_counter_delete_trigger.sql
--
-- Fix phantom-sale drift on beats.lease_count + beats.total_lease_revenue.
--
-- Problem: migration 011 set up an AFTER INSERT trigger on beat_purchases
-- that increments these counters. There was no DELETE-side trigger, so
-- when a beat_purchases row gets removed (test cleanup, manual admin
-- deletion, etc.) the counters stay elevated. The beat store displays
-- "X sold" from these counters, but accounting reads the actual rows
-- — drift produces phantom sales visible to customers but invisible
-- to admin.
--
-- This migration:
--   1. Adds an AFTER DELETE trigger that decrements both counters.
--      Uses GREATEST(0, …) to avoid going negative if ever miscounted.
--   2. Re-syncs all existing beats so any historical drift is cleaned
--      up in one pass. Read-only audit query produced the same numbers
--      as this UPDATE, so nothing else needed.

-- Trigger function — mirrors the INSERT increment logic.
CREATE OR REPLACE FUNCTION public.decrement_beat_counters_on_purchase_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.beats
  SET
    lease_count = GREATEST(0, COALESCE(lease_count, 0) - 1),
    total_lease_revenue = GREATEST(0, COALESCE(total_lease_revenue, 0) - COALESCE(OLD.amount_paid, 0))
  WHERE id = OLD.beat_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_beat_purchase_delete ON public.beat_purchases;
CREATE TRIGGER on_beat_purchase_delete
  AFTER DELETE ON public.beat_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.decrement_beat_counters_on_purchase_delete();

-- Also handle the soft-revoke case. When admin sets revoked_at on a
-- purchase row (lease grandfathered, fraud, refund), the row stays
-- but should no longer count as an active sale. We honor this by
-- excluding revoked rows in the resync below + on the BeatCard
-- aggregations going forward.

-- One-pass resync: rebuild lease_count and total_lease_revenue from
-- the actual non-revoked beat_purchases rows. Idempotent — running
-- this against a clean DB produces no changes.
WITH actuals AS (
  SELECT
    beat_id,
    COUNT(*) AS actual_count,
    COALESCE(SUM(amount_paid), 0) AS actual_revenue
  FROM public.beat_purchases
  WHERE revoked_at IS NULL
  GROUP BY beat_id
)
UPDATE public.beats b
SET
  lease_count = COALESCE(actuals.actual_count, 0),
  total_lease_revenue = COALESCE(actuals.actual_revenue, 0)
FROM actuals
WHERE actuals.beat_id = b.id
  AND (
    b.lease_count IS DISTINCT FROM actuals.actual_count
    OR COALESCE(b.total_lease_revenue, 0) IS DISTINCT FROM COALESCE(actuals.actual_revenue, 0)
  );

-- Also reset beats that have counters > 0 but NO purchases at all
-- (the MOLOTOV case — the LEFT-side join above doesn't catch these).
UPDATE public.beats
SET
  lease_count = 0,
  total_lease_revenue = 0
WHERE (lease_count > 0 OR COALESCE(total_lease_revenue, 0) > 0)
  AND NOT EXISTS (
    SELECT 1 FROM public.beat_purchases bp
    WHERE bp.beat_id = beats.id AND bp.revoked_at IS NULL
  );
