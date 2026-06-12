-- 030_cash_events.sql
--
-- Adds the concept of "cash events" — batch-capable admin actions that move
-- money through the lifecycle:
--
--   owed        (engineer took cash from client during a session)
--     ↓  cash_events row, event_type = 'collection'
--   collected   (engineer handed cash to the studio — no longer engineer's liability)
--     ↓  cash_events row, event_type = 'deposit'
--   deposited   (studio put cash in the bank)
--
-- Each transition can be single-entry or batch. The cash_events row captures
-- who did it, when, under what reference (check #, deposit slip, etc.), and
-- a total — so the paper trail survives even if an entry is later edited.
--
-- The cash_ledger.status column still reflects the current state (for fast
-- reads), but the *event history* lives in cash_events. Never overwrite an
-- event — audit integrity beats tidiness.
--
-- Collection has historically been per-entry (collected_at / collected_note
-- directly on cash_ledger). We leave that column pair in place for back-compat
-- and populate collection_event_id going forward. Old rows will have a
-- populated collected_at but a NULL collection_event_id — that's fine.

CREATE TABLE IF NOT EXISTS cash_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('collection', 'deposit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  performed_by TEXT NOT NULL,
  reference TEXT,
  note TEXT,
  total_cents BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cash_events_type_created
  ON cash_events(event_type, created_at DESC);

-- Link cash_ledger rows to the events that moved them.
ALTER TABLE cash_ledger
  ADD COLUMN IF NOT EXISTS collection_event_id UUID REFERENCES cash_events(id),
  ADD COLUMN IF NOT EXISTS deposit_event_id    UUID REFERENCES cash_events(id),
  ADD COLUMN IF NOT EXISTS deposited_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_collection_event
  ON cash_ledger(collection_event_id);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_deposit_event
  ON cash_ledger(deposit_event_id);

-- Guardrail: status must be one of the three known states. Enforced at the
-- database layer so a buggy client can't invent a "pending" or "cleared"
-- status by accident.
--
-- Existing rows are either 'owed' or 'collected' per the app, so this will
-- pass cleanly on apply.
ALTER TABLE cash_ledger
  DROP CONSTRAINT IF EXISTS cash_ledger_status_check;
ALTER TABLE cash_ledger
  ADD CONSTRAINT cash_ledger_status_check
  CHECK (status IN ('owed', 'collected', 'deposited'));

-- Sanity constraint: a deposit event on a row implies it is marked
-- 'deposited'. This prevents half-migrated rows from existing.
ALTER TABLE cash_ledger
  DROP CONSTRAINT IF EXISTS cash_ledger_deposit_consistency;
ALTER TABLE cash_ledger
  ADD CONSTRAINT cash_ledger_deposit_consistency
  CHECK (
    (deposit_event_id IS NULL AND deposited_at IS NULL)
    OR
    (deposit_event_id IS NOT NULL AND deposited_at IS NOT NULL AND status = 'deposited')
  );
