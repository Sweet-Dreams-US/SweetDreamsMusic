-- 053_password_reset_tokens.sql
--
-- Custom password reset tokens — bypasses Supabase Auth's built-in recovery
-- flow because GoTrue's /admin/generate_link endpoint always fires the
-- email through Supabase's SMTP, which on this project is rate-limited /
-- broken. Users were getting "error sending recovery email" or no email
-- at all.
--
-- New flow:
--   1. POST /api/auth/forgot-password — mint a row here, email the link
--      via Resend with our branded template
--   2. /reset-password?token=<token> — validate + let user pick a new
--      password
--   3. POST /api/auth/reset-password — validate token, mark used,
--      update password via auth.admin.updateUserById()
--
-- Tokens are single-use, expire after 1 hour, and only readable via
-- service role (no RLS policy that grants anon/auth access — anon role
-- has no SELECT/INSERT/UPDATE/DELETE on this table at all).

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cleanup index (we'll periodically delete expired/used tokens; meantime
-- queries by user_id are useful for "rate limit per email" checks).
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON public.password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON public.password_reset_tokens (expires_at);

-- Lock the table down. Only the service role (used by /api/auth/forgot-
-- password and /api/auth/reset-password) can read/write. RLS is enabled
-- with no policies so the anon and authenticated roles have zero access.
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: explicitly revoke any default grants so even if a
-- future migration grants USAGE on the schema, this table stays admin-only.
REVOKE ALL ON public.password_reset_tokens FROM anon, authenticated;
