-- 064_media_payment_installments.sql
--
-- Media Projects — installment payment plans + contract layer.
--
-- ────────────────────────────────────────────────────────────────────
-- SAFETY / ADDITIVE NOTE (read before applying):
--
-- This migration is PURELY ADDITIVE and CANNOT change the behavior of
-- any existing media booking:
--   • It creates ONE new table (media_payment_installments). Nothing
--     reads it unless installment rows exist for a booking.
--   • It adds THREE nullable columns to media_bookings
--     (contract_terms, contract_agreed_at, contract_agreed_by). All
--     default NULL; no existing column is touched, dropped, or
--     re-typed; no data is rewritten.
--
-- A legacy media booking (zero installment rows, NULL contract fields)
-- behaves EXACTLY as it does today: the deposit / remainder /
-- actual_deposit_paid flow in charge-remainder, record-payment,
-- resend-link, manual create, and the webhook is completely unchanged.
-- The installment + contract layer only activates for bookings that
-- have explicitly been given an installment plan.
--
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS everywhere) so
-- it is safe to re-run.
--
-- DO NOT apply to the live DB as part of code review — applying is a
-- separate, human-coordinated step. This file is the artifact.
-- ────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 1. media_payment_installments — one row per stint of a custom payment plan
-- ============================================================================
-- The manager builds a fully-custom plan: each row is a labeled stint with an
-- arbitrary amount and an optional due date. SUM(amount_cents) must equal the
-- parent booking's final_price_cents (enforced at the API layer on
-- create/edit, not by a DB constraint, since the two tables can't be cheaply
-- cross-checked in a CHECK). "Paid so far" for a plan project is
-- SUM(amount_cents WHERE status='paid').
CREATE TABLE IF NOT EXISTS media_payment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id UUID NOT NULL
    REFERENCES media_bookings(id) ON DELETE CASCADE,

  -- Display + pay order. Assigned by the API when the plan is built.
  sort_order INTEGER NOT NULL,

  -- Free-text stint label, e.g. "Deposit", "At filming", "On delivery".
  label TEXT NOT NULL,

  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),

  -- Optional target date for the stint. NULL = "no specific due date".
  due_date DATE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'link_sent', 'paid', 'void')),

  -- Stripe wiring for the per-installment Payment Link. Populated when the
  -- manager sends/resends a link; the webhook matches completion back via
  -- the link metadata (installment_id) and stamps the payment intent.
  stripe_payment_link_id TEXT,
  stripe_payment_link_url TEXT,
  stripe_payment_intent_id TEXT,

  -- Set when the stint is marked paid (by webhook for card/link, or by the
  -- manager for manual methods).
  paid_at TIMESTAMPTZ,
  paid_method TEXT
    CHECK (paid_method IN ('card', 'link', 'cash', 'venmo', 'check', 'other')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary access pattern: load all stints for a booking, in display order.
CREATE INDEX IF NOT EXISTS media_payment_installments_booking_sort_idx
  ON media_payment_installments (booking_id, sort_order);

COMMENT ON TABLE media_payment_installments IS
  'Custom installment plan for a media booking (project). One row per stint. SUM(amount_cents) == media_bookings.final_price_cents (enforced at the API). Paid-so-far for a plan project = SUM(amount_cents WHERE status=''paid''). A booking with zero rows uses the legacy deposit/remainder flow, untouched.';
COMMENT ON COLUMN media_payment_installments.status IS
  'pending → link_sent (Stripe link emailed) → paid. void retires a stint without payment. Manual methods jump straight to paid.';
COMMENT ON COLUMN media_payment_installments.paid_method IS
  'card/link set by the Stripe webhook; cash/venmo/check/other set by the manager via record-payment.';

-- updated_at trigger — reuses trg_set_updated_at() defined in 039_media_hub.sql.
DROP TRIGGER IF EXISTS media_payment_installments_updated_at ON media_payment_installments;
CREATE TRIGGER media_payment_installments_updated_at
  BEFORE UPDATE ON media_payment_installments
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================================
-- 2. Contract fields on media_bookings (all nullable, additive)
-- ============================================================================
-- contract_terms       — free-text terms the manager writes/edits per project.
-- contract_agreed_at   — timestamp the artist clicked "I agree".
-- contract_agreed_by   — auth.users id of whoever agreed (owner or band member).
ALTER TABLE media_bookings
  ADD COLUMN IF NOT EXISTS contract_terms TEXT,
  ADD COLUMN IF NOT EXISTS contract_agreed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_agreed_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN media_bookings.contract_terms IS
  'Per-project free-text contract terms (manager-authored). NULL on legacy bookings.';
COMMENT ON COLUMN media_bookings.contract_agreed_at IS
  'When the artist agreed to the contract. Payment on plan projects is gated until this is set. NULL = not yet agreed (or legacy booking with no contract).';
COMMENT ON COLUMN media_bookings.contract_agreed_by IS
  'auth.users id of the person (owner or band member) who agreed.';

-- ============================================================================
-- 3. RLS — read policy mirrors media_bookings (owner / band-member read).
--    Writes go through API routes with the service role (which bypasses RLS),
--    matching media_session_bookings in 039_media_hub.sql.
-- ============================================================================
ALTER TABLE media_payment_installments ENABLE ROW LEVEL SECURITY;

-- An installment is visible to whoever can see its parent booking: the
-- booking owner, or — if the booking is band-attached — any band member.
-- This is the same ownership model as media_bookings_owner_read and
-- media_session_bookings_visible_read.
DROP POLICY IF EXISTS media_payment_installments_owner_read ON media_payment_installments;
CREATE POLICY media_payment_installments_owner_read ON media_payment_installments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM media_bookings mb
      WHERE mb.id = media_payment_installments.booking_id
        AND (
          mb.user_id = auth.uid()
          OR (mb.band_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM band_members bm
            WHERE bm.band_id = mb.band_id AND bm.user_id = auth.uid()
          ))
        )
    )
  );
