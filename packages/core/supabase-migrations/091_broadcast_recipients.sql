-- Per-recipient tracking for admin broadcasts so a mass send that stops
-- partway (Resend rate-limit / quota) can be RESUMED until everyone gets it,
-- with NO duplicates to people who already received it.
--
-- Additive + idempotent: safe to run on a database that already has data.

-- ── 1. Per-recipient delivery rows ───────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES admin_broadcasts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (broadcast, email) — case-insensitive — so a recipient can
-- never be inserted (and therefore never sent) twice for the same broadcast.
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_recipients_broadcast_email
  ON broadcast_recipients (broadcast_id, lower(email));

-- Fast "give me everyone still pending/failed for this broadcast" lookups.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients (broadcast_id, status);

-- ── 2. Roll-up counters on the parent broadcast ──────────────────────
ALTER TABLE admin_broadcasts
  ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0;
ALTER TABLE admin_broadcasts
  ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0;
ALTER TABLE admin_broadcasts
  ADD COLUMN IF NOT EXISTS send_status TEXT DEFAULT 'complete';

-- Add the CHECK constraint separately + idempotently (ADD COLUMN ... CHECK is
-- not re-runnable, and the column may already exist from a prior partial run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_broadcasts_send_status_check'
  ) THEN
    ALTER TABLE admin_broadcasts
      ADD CONSTRAINT admin_broadcasts_send_status_check
      CHECK (send_status IN ('sending', 'partial', 'complete'));
  END IF;
END $$;

-- ── 3. Backfill existing broadcasts ──────────────────────────────────
-- Every existing admin_broadcasts row was sent fire-and-forget BEFORE this
-- table existed — those emails already went out. Mark each of their
-- recipients 'sent' so a future resume never re-sends to them.
INSERT INTO broadcast_recipients (broadcast_id, email, status, sent_at)
SELECT b.id, e.email, 'sent', b.created_at
FROM admin_broadcasts b
CROSS JOIN LATERAL unnest(b.recipient_emails) AS e(email)
WHERE e.email IS NOT NULL AND length(trim(e.email)) > 0
ON CONFLICT (broadcast_id, lower(email)) DO NOTHING;

-- Their roll-up counters reflect a completed send.
UPDATE admin_broadcasts
SET sent_count = recipient_count,
    failed_count = 0,
    send_status = 'complete'
WHERE send_status IS NULL OR send_status = 'complete';
