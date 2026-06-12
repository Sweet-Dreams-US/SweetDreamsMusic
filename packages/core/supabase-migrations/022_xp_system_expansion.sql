-- ============================================================
-- 022: XP System Expansion — reference_id for dedup, index
-- ============================================================

-- Add reference_id column for deduplication (e.g. booking ID, beat ID)
ALTER TABLE xp_log ADD COLUMN IF NOT EXISTS reference_id TEXT;

-- Composite index for dedup lookups: action + reference_id per user
CREATE INDEX IF NOT EXISTS idx_xp_log_user_action_ref
  ON xp_log(user_id, action, reference_id)
  WHERE reference_id IS NOT NULL;
