-- 055_membership_extension.sql
--
-- Round H: support membership extension as a quote shape.
--
-- An "extension" is an admin-initiated proposal to extend an active
-- membership by N months at the same per-month rate. When the
-- customer accepts + pays the first installment, instead of minting
-- a NEW entitlement, the webhook EXTENDS the existing one:
--   • bumps ends_at by N months
--   • adds N×monthly worth of balance line(s) to the existing balances
--   • updates Stripe subscription to bill N more cycles
--
-- The link is captured here as `extends_entitlement_id`. When this is
-- set, the webhook treats the quote as an extension rather than a
-- fresh purchase.

ALTER TABLE public.package_quotes
  ADD COLUMN IF NOT EXISTS extends_entitlement_id UUID
    REFERENCES public.package_entitlements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS package_quotes_extends_idx
  ON public.package_quotes (extends_entitlement_id)
  WHERE extends_entitlement_id IS NOT NULL;
