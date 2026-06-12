-- Migration 064: media_credits — generalized per-deliverable credit ledger.
--
-- The artist self-serve flow is: buy a package/item upfront -> a BALANCE of
-- deliverables lands on the account (3 short videos, 1 music video, 1 photo
-- session, ...) -> the artist SCHEDULES each later as a media session request
-- that the media team confirms.
--
-- WHY A NEW TABLE (not extend studio_credits): studio_credits is a fractional
-- HOURS ledger wired live to studio-booking redemption (/dashboard/media/credits
-- + studio_credit_redemptions + the deferred-liability view). Per-deliverable
-- credits are INTEGER COUNTS redeemed against media_session_bookings. Two clean,
-- disjoint ledgers; one combined balance view in the UI. studio_hours is kept in
-- studio_credits and is only an allow-list value here (never granted to
-- media_credits) to prevent double-grant.
CREATE TABLE IF NOT EXISTS public.media_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner: exactly one of user_id / band_id (XOR), mirrors studio_credits.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  band_id UUID REFERENCES public.bands(id) ON DELETE CASCADE,

  -- Open-ended-ish list; API validates against CREDIT_KINDS in lib/media-credits.ts.
  credit_kind TEXT NOT NULL CHECK (credit_kind IN (
    'short_video','music_video','photo_session','cover_art',
    'marketing_session','planning_call','studio_hours','other'
  )),

  -- Wallet: integer counts. Balance = quantity_granted - quantity_redeemed.
  quantity_granted INTEGER NOT NULL CHECK (quantity_granted >= 0),
  quantity_redeemed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_redeemed >= 0),

  -- Optional tier label from the buyer's configurator choice (basic/mid/premium).
  tier TEXT,

  -- Provenance + accounting (mirrors studio_credits.cost_basis_cents).
  source_booking_id UUID REFERENCES public.media_bookings(id) ON DELETE SET NULL,
  cost_basis_cents INTEGER,

  expires_at TIMESTAMPTZ,           -- NULL = no expiry (current policy)
  notes TEXT,                       -- snapshot label ("3 shorts — Mid")

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT media_credits_owner_xor CHECK (
    (user_id IS NOT NULL AND band_id IS NULL) OR
    (user_id IS NULL AND band_id IS NOT NULL)
  ),
  CONSTRAINT media_credits_redeemed_lte_granted CHECK (quantity_redeemed <= quantity_granted)
);

CREATE INDEX IF NOT EXISTS media_credits_user_idx
  ON public.media_credits(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_credits_band_idx
  ON public.media_credits(band_id) WHERE band_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_credits_outstanding_idx
  ON public.media_credits(credit_kind) WHERE (quantity_granted - quantity_redeemed) > 0;
CREATE INDEX IF NOT EXISTS media_credits_source_idx
  ON public.media_credits(source_booking_id) WHERE source_booking_id IS NOT NULL;

-- Reuse the shared updated_at trigger fn from migration 039.
DROP TRIGGER IF EXISTS media_credits_updated_at ON public.media_credits;
CREATE TRIGGER media_credits_updated_at BEFORE UPDATE ON public.media_credits
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- RLS: owner/band read (mirror studio_credits_owner_read); writes via service role.
ALTER TABLE public.media_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_credits_owner_read ON public.media_credits;
CREATE POLICY media_credits_owner_read ON public.media_credits
  FOR SELECT USING (
    user_id = auth.uid()
    OR (band_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM band_members
      WHERE band_members.band_id = media_credits.band_id
        AND band_members.user_id = auth.uid()
    ))
  );

COMMENT ON TABLE public.media_credits IS
  'Per-deliverable credit balance (short_video/music_video/photo_session/etc.) granted on media purchase, redeemed by scheduling media_session_bookings. Integer counts. Disjoint from studio_credits (fractional hours). Migration 064.';
