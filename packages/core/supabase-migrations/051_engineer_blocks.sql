-- 051_engineer_blocks.sql
--
-- Engineer-specific availability blocks. Reuses the existing studio_blocks
-- table; engineer_name = NULL means the block is studio-wide (admin set);
-- engineer_name = 'Iszac Griner' (or any roster name) means only that
-- engineer is unavailable for that window — the studio + other engineers
-- can still take bookings.
--
-- Idempotent. The new partial index keeps engineer-specific block lookups
-- fast even as the studio_blocks table grows (most rows will still be
-- studio-wide with engineer_name = NULL).

ALTER TABLE studio_blocks
  ADD COLUMN IF NOT EXISTS engineer_name TEXT;

CREATE INDEX IF NOT EXISTS studio_blocks_engineer_idx
  ON studio_blocks (engineer_name) WHERE engineer_name IS NOT NULL;

COMMENT ON COLUMN studio_blocks.engineer_name IS
  'Roster engineer name (matches bookings.requested_engineer) when this block is engineer-specific. NULL = studio-wide block (admin set).';
