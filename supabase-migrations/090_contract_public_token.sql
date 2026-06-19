-- 090_contract_public_token.sql
--
-- NO-LOGIN CONTRACT LINK (DocuSign-style).
--
-- Problem this fixes: the contract email pointed customers at the account-bound
-- order page (/dashboard/media/orders/[id]). A brand-new customer who has never
-- logged in hits a login wall / 404 and cannot read, sign, or pay for the
-- contract that was created for them.
--
-- Fix: every media_bookings row that has a contract gets a long, crypto-random
-- `public_token`. The customer receives a tokenized URL (/contract/<token>) and
-- can view the FULL contract, sign, and pay WITHOUT logging in.
--
-- SECURITY MODEL — the token is the ONLY credential:
--   * It is the sole proof of authorization for the public contract surface.
--     Whoever holds a token can view/sign/pay ONLY the single booking that token
--     resolves to, and can reach nothing else.
--   * It MUST be long + crypto-random. gen_random_bytes(24) → 24 bytes of
--     CSPRNG entropy, hex-encoded to 48 characters (well above the >= 32-char
--     floor). New tokens minted in app code use crypto.randomBytes(24).hex too.
--   * Every server route that serves this surface resolves the booking SOLELY by
--     public_token — never by a client-supplied booking id — so a token can
--     never be used to pivot to another booking's data.
--
-- Additive + idempotent. The lead applies this; do NOT apply it from code.

-- gen_random_bytes() lives in pgcrypto. Safe no-op if already enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The no-login credential. Nullable: legacy/non-contract bookings simply have no
-- token until one is minted (lazily, the first time a contract is sent).
ALTER TABLE media_bookings
  ADD COLUMN IF NOT EXISTS public_token text;

-- Uniqueness is the whole security guarantee: one token resolves to at most one
-- booking. Partial index (WHERE public_token IS NOT NULL) so the many rows that
-- never get a token don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_bookings_public_token
  ON media_bookings(public_token)
  WHERE public_token IS NOT NULL;

-- Backfill a strong token for every existing row that already has (or has been
-- offered) a contract — these are exactly the rows whose customers may have been
-- emailed a now-broken account-bound link. gen_random_bytes(24) → 48 hex chars.
UPDATE media_bookings
  SET public_token = encode(gen_random_bytes(24), 'hex')
  WHERE public_token IS NULL
    AND (contract_terms IS NOT NULL OR manager_agreed_at IS NOT NULL);
