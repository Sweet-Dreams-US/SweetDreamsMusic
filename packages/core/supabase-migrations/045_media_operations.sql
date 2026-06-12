-- 045_media_operations.sql
--
-- Round 7a operational layer for media bookings. Adds the columns +
-- table needed for admin to: track what real money has been collected
-- (vs. the deposit amount that was originally targeted), mark a row
-- as a test booking that should be excluded from accounting, attach
-- per-component completion + Drive URL state, and audit every
-- admin-driven action on a media booking.
--
-- Why a separate audit table (vs. extending booking_audit_log):
--   media_bookings rows have their own UUID space, and the FK to
--   booking_audit_log.booking_id was already pointing at bookings.id.
--   Keeping a dedicated table preserves FK integrity without
--   bifurcating the schema.
--
-- Why cash_ledger gets a media_booking_id alt-pointer (vs. a separate
-- media_cash_ledger table):
--   Cash flow is the same physical pipeline — Cole/Jay take cash from
--   a buyer, deposit it later. We don't want admin reconciling two
--   separate ledgers. The XOR rule (booking_id OR media_booking_id,
--   never both) is enforced at the application layer because we want
--   admin to be able to attribute cash to either source from the
--   same UI. SET NULL on delete protects audit history.
--
-- Idempotent.

-- ── media_bookings columns ────────────────────────────────────────
ALTER TABLE media_bookings
  ADD COLUMN IF NOT EXISTS actual_deposit_paid INTEGER,
  ADD COLUMN IF NOT EXISTS remainder_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS component_status JSONB;

COMMENT ON COLUMN media_bookings.actual_deposit_paid IS
  'Real money received in cents. Authoritative "money in" figure — accounting reads this first, falls back to deposit_cents only when null. Stripe webhook + record-payment + charge-remainder all write here.';
COMMENT ON COLUMN media_bookings.remainder_paid_at IS
  'When the remainder hit the bank. NULL while there is still an outstanding balance. Indexed for the "outstanding receivables" reports.';
COMMENT ON COLUMN media_bookings.created_by IS
  'Admin email when this row was created via /api/admin/media/bookings/manual or /api/admin/media/test-checkout. NULL for real customer-initiated checkouts.';
COMMENT ON COLUMN media_bookings.is_test IS
  'True for QA bookings created via the admin test-checkout flow. Excluded from accounting roll-ups server-side.';
COMMENT ON COLUMN media_bookings.component_status IS
  'Per-slot completion + delivery state. Shape: { [slot_key]: { completed, completed_at, completed_by, drive_url, notified_at } }. notified_at is the idempotency stamp that blocks re-sending the buyer email.';

-- Partial index speeds the receivables query — most rows are paid.
CREATE INDEX IF NOT EXISTS media_bookings_unpaid_remainder_idx
  ON media_bookings (remainder_paid_at)
  WHERE remainder_paid_at IS NULL;

-- Partial index for the "exclude test rows" filter that runs on
-- nearly every accounting query. WHERE is_test = TRUE is cheap when
-- the index only carries the rare rows.
CREATE INDEX IF NOT EXISTS media_bookings_is_test_idx
  ON media_bookings (is_test)
  WHERE is_test = TRUE;

-- ── media_booking_audit_log table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS media_booking_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID NOT NULL REFERENCES media_bookings(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  details      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_booking_audit_log_booking_idx
  ON media_booking_audit_log (booking_id, created_at DESC);

COMMENT ON TABLE media_booking_audit_log IS
  'Append-only audit trail for every admin action on a media booking. Every charge-remainder, record-payment, component-complete, manual_created_*, and total_adjusted call writes a row. CASCADE on booking delete keeps the schema clean.';
COMMENT ON COLUMN media_booking_audit_log.action IS
  'Snake-case action verb. Convention: cash_payment, venmo_payment, check_payment, other_payment, remainder_charged_card, remainder_link_sent, component_completed, component_uncompleted, total_adjusted, manual_created_cash, manual_created_link, etc.';
COMMENT ON COLUMN media_booking_audit_log.details IS
  'Free-shape JSONB with the action-specific payload. Conventionally includes amount_cents, method, payment_intent_id, drive_url, slot_key, previous_total/new_total, etc.';

-- ── cash_ledger.media_booking_id ──────────────────────────────────
ALTER TABLE cash_ledger
  ADD COLUMN IF NOT EXISTS media_booking_id UUID
  REFERENCES media_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cash_ledger_media_booking_idx
  ON cash_ledger (media_booking_id)
  WHERE media_booking_id IS NOT NULL;

COMMENT ON COLUMN cash_ledger.media_booking_id IS
  'Alt-pointer for cash collected against a media booking. XOR''d with booking_id at the application layer — exactly one of (booking_id, media_booking_id) is set per ledger row.';
