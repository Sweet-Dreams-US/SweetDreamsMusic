-- Migration 029: Distinguish "Lease Only" from "Lifetime Lease"
--
-- Before this migration, beats.has_exclusive = false implied "lifetime lease"
-- (permanent, never-expiring leases). That conflated two separate producer
-- intents:
--   1. "Lease Only" — simple MP3 lease, standard 1yr expiration, renewable.
--      Producer has no stems, doesn't want to sell exclusives.
--   2. "Lifetime Lease" — MP3 lease that never expires. Premium branding.
--
-- Adding an explicit flag so the webhook can tell them apart when setting
-- lease_expires_at. Existing has_exclusive=false beats are assumed lifetime
-- (preserves current behavior).

ALTER TABLE beats ADD COLUMN IF NOT EXISTS is_lifetime_lease BOOLEAN DEFAULT false;

-- Preserve existing behavior: any beat currently marked has_exclusive=false
-- was uploaded under the old "lifetime" semantics and should keep them.
UPDATE beats
SET is_lifetime_lease = true
WHERE has_exclusive = false AND is_lifetime_lease = false;
