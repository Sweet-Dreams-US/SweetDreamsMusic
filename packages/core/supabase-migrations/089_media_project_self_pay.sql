-- 089_media_project_self_pay.sql
--
-- Media Projects — self-serve installment payment.
--
-- ────────────────────────────────────────────────────────────────────
-- SAFETY / ADDITIVE NOTE (read before applying):
--
-- This migration is PURELY ADDITIVE and CANNOT change the behavior of
-- any existing media booking or installment:
--   • It adds ONE nullable column to media_payment_installments
--     (stripe_checkout_session_id). It defaults NULL; no existing column
--     is touched, dropped, or re-typed; no data is rewritten.
--   • It adds ONE partial-friendly index. Pure read optimization.
--
-- WHY: the self-serve "pay any amount" flow (app/api/media/bookings/[id]/pay)
-- mints a Stripe Checkout Session sized to whatever the artist chooses, then
-- the webhook (meta.type = 'media_project_payment') GREEDILY applies that
-- single payment across the pending installments in sort order. A greedy
-- apply is NOT naturally idempotent — a re-fired Stripe event would pay the
-- same installments twice. We stamp stripe_checkout_session_id on every row
-- the apply touches; the webhook's first step is to look for any row already
-- carrying this session id and, if found, skip the whole branch. That stamp
-- is the dedup key, and this column + index back it.
--
-- A booking that never uses self-serve pay (zero rows carrying a checkout
-- session id) behaves EXACTLY as it does today — the per-installment
-- Stripe-link flow (status, paid_at, stripe_payment_link_id, etc.) is
-- completely unchanged.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) so it
-- is safe to re-run.
--
-- DO NOT apply to the live DB as part of code review — applying is a
-- separate, human-coordinated step. This file is the artifact.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE media_payment_installments
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

-- Dedup lookup for the self-serve webhook: "has this checkout session
-- already been applied to this booking?" → one indexed point read.
CREATE INDEX IF NOT EXISTS idx_mpi_booking_session
  ON media_payment_installments (booking_id, stripe_checkout_session_id);

COMMENT ON COLUMN media_payment_installments.stripe_checkout_session_id IS
  'Stripe Checkout Session id stamped on every installment row touched by a self-serve project payment (meta.type=media_project_payment). The webhook checks for an existing row with this session id before applying, making a duplicate Stripe delivery a no-op. NULL on rows paid via the per-installment Payment Link flow.';
