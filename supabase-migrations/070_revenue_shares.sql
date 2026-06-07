-- Migration 070: revenue shares — per-tenant default splits + per-person
-- overrides + per-transaction snapshots. Makes the 8 hardcoded payout constants
-- admin-editable while keeping historical payroll EXACTLY frozen.
--
-- SAFETY: additive only, all snapshot/override columns NULLABLE. With no rows
-- backfilled, no overrides set, and revenue_settings seeded == the constants,
-- computeEarningsCore reproduces today's payroll to the cent (proven by
-- scripts/payroll-golden.ts). A share only moves FUTURE / un-snapshotted rows.
--
-- Percent (NUMERIC 0..100) matches the sales_commission_pct precedent (058/065).

-- ───────────────────── revenue_settings (per-tenant defaults) ─────────────────────
CREATE TABLE IF NOT EXISTS public.revenue_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,                                  -- NULL = default tenant (mirrors reward_settings)
  engineer_session_pct    NUMERIC(5,2) NOT NULL DEFAULT 60.00,  -- engineer cut of a session (business = 100-x)
  producer_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 60.00,  -- producer cut of a beat sale (platform = 100-x)
  media_seller_pct        NUMERIC(5,2) NOT NULL DEFAULT 15.00,  -- media: seller commission
  media_worker_pct        NUMERIC(5,2) NOT NULL DEFAULT 50.00,  -- media: film+edit workers (split if two)
  media_business_pct      NUMERIC(5,2) NOT NULL DEFAULT 35.00,  -- media: business cut
  renewal_discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 75.00,  -- lease renewal price = x% of original
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT media_split_sums_100 CHECK (round(media_seller_pct + media_worker_pct + media_business_pct) = 100),
  CONSTRAINT revenue_pct_bounds CHECK (
    engineer_session_pct BETWEEN 0 AND 100 AND
    producer_commission_pct BETWEEN 0 AND 100 AND
    renewal_discount_pct BETWEEN 0 AND 100
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS revenue_settings_studio_idx
  ON public.revenue_settings (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid));

DROP TRIGGER IF EXISTS revenue_settings_updated_at ON public.revenue_settings;
CREATE TRIGGER revenue_settings_updated_at BEFORE UPDATE ON public.revenue_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE public.revenue_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS revenue_settings_read ON public.revenue_settings;
CREATE POLICY revenue_settings_read ON public.revenue_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- Seed the default row from the current constants (byte-identical to today).
INSERT INTO public.revenue_settings (studio_id) VALUES (NULL)
ON CONFLICT (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

-- ───────────────────── per-person overrides (NULL = inherit default) ─────────────────────
ALTER TABLE public.engineers
  ADD COLUMN IF NOT EXISTS session_split_pct NUMERIC(5,2)
    CHECK (session_split_pct IS NULL OR (session_split_pct BETWEEN 0 AND 100));
COMMENT ON COLUMN public.engineers.session_split_pct IS 'Per-engineer session split override (NULL = use revenue_settings default). Migration 070.';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS producer_commission_pct NUMERIC(5,2)
    CHECK (producer_commission_pct IS NULL OR (producer_commission_pct BETWEEN 0 AND 100));
COMMENT ON COLUMN public.profiles.producer_commission_pct IS 'Per-producer beat commission override (NULL = use revenue_settings default). Migration 070.';

-- ───────────────────── per-transaction snapshots (NULL = fall back) ─────────────────────
-- The EFFECTIVE percent is stamped here at completion/sale so a later rate change
-- never retroactively alters earned payroll. NULL on every existing row → the
-- payroll math falls back to override/default/constant (= today's numbers).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS engineer_split_pct NUMERIC(5,2)
    CHECK (engineer_split_pct IS NULL OR (engineer_split_pct BETWEEN 0 AND 100));

ALTER TABLE public.beat_purchases
  ADD COLUMN IF NOT EXISTS producer_pct NUMERIC(5,2)
    CHECK (producer_pct IS NULL OR (producer_pct BETWEEN 0 AND 100));

ALTER TABLE public.media_sales
  ADD COLUMN IF NOT EXISTS seller_pct NUMERIC(5,2)
    CHECK (seller_pct IS NULL OR (seller_pct BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS worker_pct NUMERIC(5,2)
    CHECK (worker_pct IS NULL OR (worker_pct BETWEEN 0 AND 100));

COMMENT ON TABLE public.revenue_settings IS 'Per-tenant revenue-share defaults (engineer/producer/media/renewal). Seeded from constants. Migration 070.';
