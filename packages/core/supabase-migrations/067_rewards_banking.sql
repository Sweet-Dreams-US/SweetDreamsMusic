-- Migration 067: rewards banking — pay staff on the full VALUE of the work.
--
-- The crux fix. Today payroll pays an engineer `bookings.total_amount * 0.60`, so a
-- comped/credit session (total_amount = $0) pays the engineer $0 for real work — a
-- pre-existing bug in the prepaid-credits feature. We add the full value of the
-- session and pay staff on THAT; rewards reduce revenue (total_amount), never pay.
-- Design: docs/superpowers/specs/2026-06-06-rewards-banking-design.md
--
-- Depends on migration 066 (reward_grants).

ALTER TABLE public.bookings
  -- The full normal value of the work (base + surcharges + guest fees). Staff payout
  -- = service_value_cents * split. For normal bookings this equals total_amount; for
  -- a comped/discounted reward booking it stays the full value while total_amount is
  -- the (reduced/zero) amount the customer actually paid. rewards cost = the gap.
  ADD COLUMN IF NOT EXISTS service_value_cents INTEGER,
  -- Which reward grant funded/discounted this booking (so it's marked redeemed + traceable).
  ADD COLUMN IF NOT EXISTS reward_grant_id UUID REFERENCES public.reward_grants(id) ON DELETE SET NULL;

-- Backfill: value existing bookings at what they CHARGED. This keeps every existing
-- payout identical (normal sessions unchanged) AND leaves past comped/credit sessions
-- at $0 — i.e. we do NOT retroactively back-pay them (Cole: going-forward only).
UPDATE public.bookings
  SET service_value_cents = COALESCE(total_amount, 0)
  WHERE service_value_cents IS NULL;

CREATE INDEX IF NOT EXISTS bookings_reward_grant_idx
  ON public.bookings(reward_grant_id) WHERE reward_grant_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.service_value_cents IS
  'Full value of the work (base+surcharges+guest fees). Staff paid on this; total_amount is what the customer paid; rewards cost = service_value_cents - total_amount. Backfilled = total_amount (no retroactive backpay). Migration 067.';
