-- 077: Tracking exemption — staff + producers (and anyone toggled) never pause.
--
-- The 90-day paid-activity rule (075) makes no sense for the studio's own
-- people: engineers/media managers/producers don't "book sessions", so the view
-- would mark them paused — dropping them from the Cowork weekly queue, holding
-- their stats off charts, and even sending them the win-back email. Per Cole:
-- a toggle exception so tracking stays ON.
--
-- Two layers, both surfaced through artist_tracking_status (everything
-- downstream — agent queue, pause-email sweep, chart_eligible_metrics, the hub
-- paused banner — keys off this one view, so nothing else needs changing):
--   1. AUTO: staff roles (engineer / media_manager / admin) + producers
--      (profiles.is_producer) are always active.
--   2. MANUAL: profiles.tracking_always_on — the admin toggle in Admin → Users
--      for any other account that should never pause (e.g. a VIP artist).
--
-- NOTE: the views are DROPped + recreated (not CREATE OR REPLACE) because the
-- new always_on column sits before is_active — Postgres can't insert view
-- columns in place. chart_eligible_metrics depends on the status view, so both
-- go together. Run the ALTER TABLE separately FIRST if your runner wraps the
-- whole file in one transaction that might roll back.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tracking_always_on BOOLEAN NOT NULL DEFAULT FALSE;

DROP VIEW IF EXISTS public.chart_eligible_metrics;
DROP VIEW IF EXISTS public.artist_tracking_status;

CREATE VIEW public.artist_tracking_status
WITH (security_invoker = true) AS
SELECT
  p.user_id,
  p.email,
  GREATEST(b.last_paid_at, bp.last_paid_at, mb.last_paid_at, pk.last_paid_at, sub.last_paid_at) AS last_paid_at,
  (
    p.tracking_always_on
    OR p.role IN ('engineer', 'media_manager', 'admin')
    OR p.is_producer
  ) AS always_on,
  COALESCE(
    p.tracking_always_on
    OR p.role IN ('engineer', 'media_manager', 'admin')
    OR p.is_producer
    OR GREATEST(b.last_paid_at, bp.last_paid_at, mb.last_paid_at, pk.last_paid_at, sub.last_paid_at)
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
  -- Per-row LEAST (paid-through capped at now), THEN max — zero rows yield NULL.
  SELECT max(LEAST(e.current_period_end, now())) AS last_paid_at
  FROM public.package_entitlements e
  WHERE e.user_id = p.user_id
    AND e.stripe_subscription_id IS NOT NULL
    AND e.payment_status = 'current'
) sub ON true;

CREATE VIEW public.chart_eligible_metrics
WITH (security_invoker = true) AS
SELECT m.*
FROM public.artist_metrics m
JOIN public.artist_tracking_status t ON t.user_id = m.user_id
WHERE m.source IN ('agent', 'spotify_api', 'youtube_api')
  AND COALESCE((m.metadata->>'anomaly')::boolean, false) = false
  AND t.is_active = true;

COMMENT ON VIEW public.artist_tracking_status IS
  'ACTIVE = paid in last 90 days OR always_on (staff roles, producers, or the tracking_always_on toggle). Drives agent queue, pause emails, chart eligibility. Service client only. Migrations 075 + 077.';
COMMENT ON VIEW public.chart_eligible_metrics IS
  'Chart-eligible artist metrics: source agent/spotify_api/youtube_api, no unreviewed anomaly, owner active. manual + screenshot_verified rows never chart. Migrations 075 + 077.';
COMMENT ON COLUMN public.profiles.tracking_always_on IS
  'Admin toggle: this account''s stat tracking never pauses regardless of paid activity. Staff roles + producers are auto-exempt without it. Migration 077.';
