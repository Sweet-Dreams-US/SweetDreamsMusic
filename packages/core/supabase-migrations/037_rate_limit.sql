-- Migration 037: Supabase-backed rate limiting.
--
-- Context: we replaced Upstash Redis with Postgres because the app already has
-- a paid Supabase tier and we didn't want another vendor. The rate-limit path
-- pays ~15-30ms of extra latency vs Redis, which is acceptable for this traffic
-- profile. Connection pooling on the paid tier + no connections-per-invocation
-- overhead (we reuse the server-side service client) keeps it tolerable.
--
-- Two tables:
--   rate_limit_events  — one row per allowed event (sliding window counter)
--   rate_limit_dedup   — "seen once in window" keys (play-count dedup)
--
-- Three RPCs:
--   rate_limit_check(bucket, id, max, window_s) → JSONB
--   mark_once(key, ttl_s)                       → BOOLEAN
--   rate_limit_cleanup()                        → void (for cron)
--
-- All RPCs are SECURITY DEFINER with a restricted search_path. Only service_role
-- can EXECUTE them — the anon/authenticated roles have NO direct access to the
-- tables or the functions, so rate-limit state can't be tampered with from the
-- client.

---------------------------------------------------------------------
-- 1. rate_limit_events — sliding window counter storage.
---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id          BIGSERIAL PRIMARY KEY,
  bucket      TEXT        NOT NULL,
  identifier  TEXT        NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the hot query: count events in (bucket, identifier) since T.
-- DESC on occurred_at lets the planner quickly bail out once it's past the
-- window boundary.
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON rate_limit_events (bucket, identifier, occurred_at DESC);

-- Cleanup index — cron scans the oldest rows and deletes anything past TTL.
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_occurred_at
  ON rate_limit_events (occurred_at);

ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Service-role-only access. The rate-limit code calls via createServiceClient,
-- so it bypasses RLS entirely. The policy exists mostly to make RLS explicit
-- for advisors; anon/authenticated should never touch this table.
DROP POLICY IF EXISTS "Service role full access" ON rate_limit_events;
CREATE POLICY "Service role full access" ON rate_limit_events
  TO service_role USING (true) WITH CHECK (true);

---------------------------------------------------------------------
-- 2. rate_limit_dedup — "seen once in window" keys.
---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limit_dedup (
  key        TEXT        PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for cleanup cron.
CREATE INDEX IF NOT EXISTS idx_rate_limit_dedup_expires_at
  ON rate_limit_dedup (expires_at);

ALTER TABLE rate_limit_dedup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON rate_limit_dedup;
CREATE POLICY "Service role full access" ON rate_limit_dedup
  TO service_role USING (true) WITH CHECK (true);

---------------------------------------------------------------------
-- 3. rate_limit_check — the main sliding-window RPC.
---------------------------------------------------------------------
--
-- Contract (matches Upstash's @upstash/ratelimit.slidingWindow):
--   Input:  bucket, identifier, max (per window), window_seconds
--   Output: { success, limit, remaining, reset (ms epoch) }
--
-- The insert happens only when success=true, so a rejected request doesn't
-- keep the window from sliding away. This mirrors Upstash's behavior and is
-- why brute-force attackers can't "pin" the window by firing during the 429.

CREATE OR REPLACE FUNCTION rate_limit_check(
  p_bucket         TEXT,
  p_identifier     TEXT,
  p_max            INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_window_start  TIMESTAMPTZ := v_now - MAKE_INTERVAL(secs => p_window_seconds);
  v_count         INTEGER;
  v_reset_ms      BIGINT;
  v_success       BOOLEAN;
BEGIN
  -- Count events inside the sliding window.
  SELECT COUNT(*) INTO v_count
  FROM rate_limit_events
  WHERE bucket = p_bucket
    AND identifier = p_identifier
    AND occurred_at > v_window_start;

  v_success := v_count < p_max;

  -- Only insert on success — rejected requests don't refresh the window.
  IF v_success THEN
    INSERT INTO rate_limit_events (bucket, identifier, occurred_at)
    VALUES (p_bucket, p_identifier, v_now);
    v_count := v_count + 1;
  END IF;

  -- Reset is "when the oldest-in-window event exits the window". If there are
  -- no events yet, it's window_seconds from now. In milliseconds (JS epoch).
  SELECT EXTRACT(EPOCH FROM (MIN(occurred_at) + MAKE_INTERVAL(secs => p_window_seconds))) * 1000
    INTO v_reset_ms
  FROM rate_limit_events
  WHERE bucket = p_bucket
    AND identifier = p_identifier
    AND occurred_at > v_window_start;

  IF v_reset_ms IS NULL THEN
    v_reset_ms := EXTRACT(EPOCH FROM (v_now + MAKE_INTERVAL(secs => p_window_seconds))) * 1000;
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'success',   v_success,
    'limit',     p_max,
    'remaining', GREATEST(0, p_max - v_count),
    'reset',     v_reset_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION rate_limit_check(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_check(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

---------------------------------------------------------------------
-- 4. mark_once — atomic "first-seen" dedup with TTL.
---------------------------------------------------------------------
--
-- Returns TRUE if THIS call is the first to mark the key (or if the prior
-- mark has already expired). Returns FALSE if the key is still live.
--
-- Concurrency: we use SELECT ... FOR UPDATE to serialize contenders for the
-- same key. The unique_violation catch handles the narrow window where two
-- concurrent transactions both read "not exists" and then race to INSERT.
--
-- Why not INSERT ... ON CONFLICT: the xmax=0 trick to distinguish "did INSERT"
-- from "did UPDATE" is brittle for this use case because we need THREE
-- outcomes (new, refreshed-expired, blocked-alive), not two.

CREATE OR REPLACE FUNCTION mark_once(
  p_key         TEXT,
  p_ttl_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now     TIMESTAMPTZ := NOW();
  v_expiry  TIMESTAMPTZ := v_now + MAKE_INTERVAL(secs => p_ttl_seconds);
  v_existing_expires_at TIMESTAMPTZ;
BEGIN
  -- Lock any existing row for this key.
  SELECT expires_at INTO v_existing_expires_at
  FROM rate_limit_dedup
  WHERE key = p_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_expires_at > v_now THEN
      -- Still alive — blocked.
      RETURN FALSE;
    ELSE
      -- Expired — refresh it and allow.
      UPDATE rate_limit_dedup
      SET expires_at = v_expiry
      WHERE key = p_key;
      RETURN TRUE;
    END IF;
  END IF;

  -- No existing row — insert and allow. The EXCEPTION block handles the rare
  -- race where another transaction inserted the same key between our SELECT
  -- and INSERT.
  BEGIN
    INSERT INTO rate_limit_dedup (key, expires_at)
    VALUES (p_key, v_expiry);
    RETURN TRUE;
  EXCEPTION WHEN unique_violation THEN
    RETURN FALSE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION mark_once(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_once(TEXT, INTEGER) TO service_role;

---------------------------------------------------------------------
-- 5. rate_limit_cleanup — delete stale rows. Called by Vercel cron.
---------------------------------------------------------------------
--
-- Each call deletes rows older than the widest realistic window (1 hour buys
-- us plenty of headroom — our widest bucket is 60s) and any dedup rows past
-- their individual expiry. Running hourly is fine.

CREATE OR REPLACE FUNCTION rate_limit_cleanup()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM rate_limit_events
  WHERE occurred_at < NOW() - INTERVAL '1 hour';

  DELETE FROM rate_limit_dedup
  WHERE expires_at < NOW();
END;
$$;

REVOKE ALL ON FUNCTION rate_limit_cleanup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_cleanup() TO service_role;
