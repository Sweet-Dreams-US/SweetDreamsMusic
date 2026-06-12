-- Add lease revocation tracking to beat_purchases
-- When an exclusive is purchased, all existing leases on that beat are revoked

ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

-- Index for efficient lookup of active leases by beat
CREATE INDEX IF NOT EXISTS idx_beat_purchases_active_leases
  ON beat_purchases (beat_id, license_type)
  WHERE revoked_at IS NULL;
