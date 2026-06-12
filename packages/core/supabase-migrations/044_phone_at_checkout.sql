-- 044_phone_at_checkout.sql
--
-- Round 6 added phone-at-checkout so admin can call the buyer to plan
-- the project. Two columns:
--
--   profiles.phone           — persisted across orders. Pre-fills the
--                              checkout phone field on subsequent
--                              orders so the buyer doesn't retype.
--   media_bookings.customer_phone — snapshotted per order at checkout
--                              time. Even if the buyer later changes
--                              their profile phone, the historical
--                              snapshot stays put on the order row.
--
-- We intentionally store both because:
--   • Order-time snapshot is forensic — what number did they give us
--     when they bought THIS specific package
--   • Profile phone is current — what's the right number to call them
--     today
--
-- Validation lives at the application layer (>= 7 digits accepted —
-- formats vary too much to regex meaningfully). Admin alerts render
-- this as a tel: link.
--
-- Idempotent.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE media_bookings
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

COMMENT ON COLUMN profiles.phone IS
  'Buyer phone — persisted across orders, pre-fills the checkout form.';
COMMENT ON COLUMN media_bookings.customer_phone IS
  'Snapshot of the phone number at order time. Forensic — survives later profile.phone edits.';
