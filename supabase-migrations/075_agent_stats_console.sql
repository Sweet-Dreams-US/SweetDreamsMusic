-- 075: Agent Stats Console — agent role plumbing, tracking-status view, agent_runs,
-- pause notices, chart-eligibility view.
--
-- All additive / inert: nothing in production code reads these objects until the
-- agent-stats-console branch ships. profiles.role has NO CHECK constraint (verified
-- live), so the new 'agent' role value needs no constraint surgery — enforcement is
-- code-side (getUserRole + the update-role allowlist). The console's enforcement
-- model matches the rest of the app: per-page/per-route role gates + service-role
-- clients; the existing auth.uid()=user_id RLS on artist_metrics/platform_connections
-- already denies an agent direct table access to other users' rows.

-- 1. artist_metrics: metadata (anomaly flag, run linkage) + recorded_by.
ALTER TABLE public.artist_metrics ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.artist_metrics ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fast "latest agent snapshot per artist/platform" lookups for the queue.
CREATE INDEX IF NOT EXISTS idx_artist_metrics_agent
  ON public.artist_metrics (user_id, platform, metric_date DESC)
  WHERE source = 'agent';

-- 2. artist_tracking_status — ACTIVE = any paid activity in the last 90 days.
-- Paid activity: booking deposit (bookings rows are born paid; email-keyed —
-- bookings has no user_id), beat purchase, media booking payment, package quote
-- accepted (= paid via Stripe webhook), or a current package subscription
-- (paid-through capped at now() for sane display).
-- ⚠ security_invoker: ALWAYS query this view with the SERVICE client — under a
-- user-scoped client the underlying tables' RLS would silently empty the laterals.
CREATE OR REPLACE VIEW public.artist_tracking_status
WITH (security_invoker = true) AS
SELECT
  p.user_id,
  p.email,
  GREATEST(b.last_paid_at, bp.last_paid_at, mb.last_paid_at, pk.last_paid_at, sub.last_paid_at) AS last_paid_at,
  COALESCE(
    GREATEST(b.last_paid_at, bp.last_paid_at, mb.last_paid_at, pk.last_paid_at, sub.last_paid_at)
      >= now() - interval '90 days',
    false
  ) AS is_active
FROM public.profiles p
LEFT JOIN LATERAL (
  SELECT max(bk.created_at) AS last_paid_at
  FROM public.bookings bk
  WHERE lower(bk.customer_email) = lower(p.email)
    AND bk.total_amount > 0
    AND bk.deleted_at IS NULL
    AND bk.status <> 'deleted'
) b ON true
LEFT JOIN LATERAL (
  SELECT max(x.created_at) AS last_paid_at
  FROM public.beat_purchases x
  WHERE (x.buyer_id = p.user_id OR lower(x.buyer_email) = lower(p.email))
    AND x.amount_paid > 0
) bp ON true
LEFT JOIN LATERAL (
  SELECT max(GREATEST(m.deposit_paid_at, m.final_paid_at, m.remainder_paid_at)) AS last_paid_at
  FROM public.media_bookings m
  WHERE m.user_id = p.user_id AND m.is_test = false
) mb ON true
LEFT JOIN LATERAL (
  SELECT max(q.accepted_at) AS last_paid_at
  FROM public.package_quotes q
  WHERE q.user_id = p.user_id AND q.status = 'accepted'
) pk ON true
LEFT JOIN LATERAL (
  -- Per-row LEAST (paid-through capped at now), THEN max — so zero rows yield
  -- NULL. LEAST(max(...), now()) would return now() for everyone (LEAST skips
  -- NULL args), wrongly marking every artist active.
  SELECT max(LEAST(e.current_period_end, now())) AS last_paid_at
  FROM public.package_entitlements e
  WHERE e.user_id = p.user_id
    AND e.stripe_subscription_id IS NOT NULL
    AND e.payment_status = 'current'
) sub ON true;

COMMENT ON VIEW public.artist_tracking_status IS
  'ACTIVE = paid activity in last 90 days (bookings by email, beats, media, packages). Drives the agent work queue + pause emails. Query with the service client only. Migration 075.';

-- 3. chart_eligible_metrics — the ONLY rows DreamSuite Charts may read:
-- verified sources, not flagged anomalous, owner currently active.
CREATE OR REPLACE VIEW public.chart_eligible_metrics
WITH (security_invoker = true) AS
SELECT m.*
FROM public.artist_metrics m
JOIN public.artist_tracking_status t ON t.user_id = m.user_id
WHERE m.source IN ('agent', 'spotify_api', 'youtube_api')
  AND COALESCE((m.metadata->>'anomaly')::boolean, false) = false
  AND t.is_active = true;

COMMENT ON VIEW public.chart_eligible_metrics IS
  'Chart-eligible artist metrics: source agent/spotify_api/youtube_api, no unreviewed anomaly, owner active. manual + screenshot_verified rows never chart. Migration 075.';

-- ───────────────────────── agent_runs ─────────────────────────
-- One row per Cowork console session; counters incremented by POST /api/agent/metrics.
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  instance TEXT NOT NULL,
  agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  artists_processed INTEGER NOT NULL DEFAULT 0,
  platforms_recorded INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  anomaly_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_date ON public.agent_runs (run_date DESC);

DROP TRIGGER IF EXISTS trg_agent_runs_updated ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_updated
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Service-role only (the console routes gate on the agent role, then write with
-- the service client). RLS on with no policies = deny-by-default for user clients.
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_runs IS
  'Cowork agent console runs: per-day counters for the end-of-day report. Service-role writes only. Migration 075.';

-- ───────────────────────── agent_pause_notices ─────────────────────────
-- One win-back email per pause EPISODE: re-emailed only after the artist resumes
-- (new last_paid_at) and later pauses again.
CREATE TABLE IF NOT EXISTS public.agent_pause_notices (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_paid_at_at_notice TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_agent_pause_notices_updated ON public.agent_pause_notices;
CREATE TRIGGER trg_agent_pause_notices_updated
  BEFORE UPDATE ON public.agent_pause_notices
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE public.agent_pause_notices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_pause_notices IS
  'Tracks the once-per-pause win-back email so the cron never re-spams. Service-role only. Migration 075.';
