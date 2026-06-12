-- 056_booking_cash_corrections.sql
--
-- Audit log for post-completion cash-amount corrections on bookings.
-- Engineers + admins occasionally need to update the cash collected
-- after a session ends (customer ended early, agreed on a different
-- amount, mis-keyed). Without an audit trail, those edits look
-- indistinguishable from fraud — admin has no way to know whether a
-- $180 → $120 change is a legit correction or someone pocketing $60.
--
-- This table records every correction with:
--   • who made it (auth user_id + email + role)
--   • when
--   • what changed (old → new amount)
--   • why (free-form reason, required)
--
-- The bookings.total_amount + cash_ledger.amount updates happen as
-- normal table writes; this log sits alongside them for review.

CREATE TABLE IF NOT EXISTS public.booking_cash_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  -- Pre-correction values (snapshot at the moment of the edit).
  previous_total_cents INTEGER NOT NULL,
  previous_cash_ledger_amount_cents INTEGER,
  -- Post-correction values (what we set them to).
  new_total_cents INTEGER NOT NULL,
  new_cash_ledger_amount_cents INTEGER,
  -- Required reason — admin needs context to verify legitimacy.
  reason TEXT NOT NULL CHECK (length(reason) >= 5),
  -- Who made the change.
  corrected_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  corrected_by_email TEXT NOT NULL,
  corrected_by_role TEXT NOT NULL CHECK (corrected_by_role IN ('admin','engineer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_cash_corrections_booking_idx
  ON public.booking_cash_corrections (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_cash_corrections_user_idx
  ON public.booking_cash_corrections (corrected_by_user_id, created_at DESC);

-- Lock down: only service role reads/writes (the API endpoint uses
-- service-role; admin UI fetches via that endpoint with admin
-- verification). RLS enabled with no policies to prevent direct
-- end-user reads.
ALTER TABLE public.booking_cash_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_cash_corrections FROM anon, authenticated;
