-- Lease expiration, renewal, and upgrade tracking
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS renewal_blocked BOOLEAN DEFAULT false;
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS renewed_from_id UUID;
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS upgraded_from_id UUID;
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS expiry_warning_sent BOOLEAN DEFAULT false;
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS expiry_notice_sent BOOLEAN DEFAULT false;

-- Ensure license_text column exists (used by webhook but may be missing from schema)
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS license_text TEXT;

-- Index for finding expiring leases (used by cron)
CREATE INDEX IF NOT EXISTS idx_beat_purchases_expiring
  ON beat_purchases (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL AND revoked_at IS NULL;
