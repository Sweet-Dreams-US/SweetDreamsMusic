-- ============================================================
-- Migration 035 — Stripe webhook idempotency table.
--
-- Problem: /api/booking/webhook handles 8 different `checkout.session.completed`
-- branches (booking_deposit, band_booking_deposit, invite_deposit,
-- booking_remainder, beat_purchase, beat_renewal, beat_upgrade,
-- private_beat_sale). Only the async_payment_succeeded branch dedups by
-- stripe_checkout_session_id before inserting. If Stripe retries a 2xx-after-
-- timeout, the other branches can double-insert bookings, create duplicate
-- beat purchases, double-subtract remainder balances, double-award XP, and
-- re-send confirmation emails.
--
-- Fix: use Stripe's canonical idempotency key — `event.id` is unique per
-- webhook delivery. On first receipt, claim the id. On retry, detect the
-- claim and short-circuit with a 200. Stripe treats that as "done, don't
-- retry further."
--
-- Rationale for claim-at-start vs. claim-at-end:
--   - Claim-at-start (what this implements): guarantees NO double processing,
--     even if two retries arrive simultaneously during a long handler run.
--     Tradeoff: if the handler crashes mid-way, subsequent retries also skip
--     (we lose retry recovery for that specific event).
--   - Claim-at-end: allows retry recovery on crash, but allows double-processing
--     if two retries arrive within the handler's processing window.
--
-- For a studio booking site, double-processing is the worse failure mode
-- (duplicate bookings, duplicate charges to customers, roster pollution).
-- If a webhook handler crashes mid-way, admin can reconcile from the Stripe
-- dashboard. Claim-at-start wins.
-- ============================================================

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries (retention policy could delete old rows).
CREATE INDEX IF NOT EXISTS stripe_webhook_events_received_at_idx
  ON stripe_webhook_events (received_at DESC);

-- RLS — only service role reads/writes this table. Never surfaced to clients.
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access on stripe_webhook_events"
  ON stripe_webhook_events;

CREATE POLICY "service_role full access on stripe_webhook_events"
  ON stripe_webhook_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
