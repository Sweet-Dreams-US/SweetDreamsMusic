-- 079: Tax Center (Plan 5) — preparation + organization, NOT tax advice.
--
-- All tables admin-only (owner business data); writes go through admin-gated
-- service-client routes (RLS is defense-in-depth). Singleton tables mirror
-- brand_settings (071): studio_id NULL = default tenant, COALESCE unique index.
--
-- ⚠ HOLD FOR CPA REVIEW before any studio sees Phase-4 numbers or lesson copy:
-- tax_constants seed values + the SE/income-tax math + lessons are launch-gated
-- on a real CPA sign-off (Plan 5 "Pre-ship review").
--
-- ⚠ EIN/TIN: we store ONLY last-4 + the uploaded W-9 PDF in a PRIVATE bucket.
-- No full SSN/EIN at rest — this app has no key-management infra, and a
-- half-baked secret is worse than not holding the number. The CPA gets the W-9.

-- ── 1. business_tax_profiles (singleton per tenant) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.business_tax_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,
  entity_type TEXT NOT NULL DEFAULT 'sole_prop'
    CHECK (entity_type IN ('sole_prop', 'smllc', 's_corp', 'partnership')),
  ein_last4 TEXT,                                  -- display only; never the full EIN
  state TEXT,                                       -- 2-letter; drives nothing tax-wise in v1 (sales tax is a flag, not a feature)
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  estimated_income_tax_rate NUMERIC(5,2) NOT NULL DEFAULT 22.00 CHECK (estimated_income_tax_rate >= 0 AND estimated_income_tax_rate <= 100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_tax_profiles_studio_idx
  ON public.business_tax_profiles (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid));
DROP TRIGGER IF EXISTS trg_business_tax_profiles_updated ON public.business_tax_profiles;
CREATE TRIGGER trg_business_tax_profiles_updated BEFORE UPDATE ON public.business_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
ALTER TABLE public.business_tax_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_tax_profiles_admin_read ON public.business_tax_profiles;
CREATE POLICY business_tax_profiles_admin_read ON public.business_tax_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));
INSERT INTO public.business_tax_profiles (studio_id) VALUES (NULL)
  ON CONFLICT (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

-- ── 2. business_expenses — extend the existing (empty) shell ──────────────────
-- The table already exists (id, studio_id, category, description, amount_cents,
-- incurred_on, paid_on, vendor, receipt_storage_path, notes, created_by,
-- deleted_at, deleted_by, timestamps). Add the Tax Center fields:
ALTER TABLE public.business_expenses ADD COLUMN IF NOT EXISTS is_equipment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.business_expenses ADD COLUMN IF NOT EXISTS recurring_template_id UUID;
CREATE INDEX IF NOT EXISTS business_expenses_incurred_idx
  ON public.business_expenses (incurred_on) WHERE deleted_at IS NULL;
-- (RLS expenses_admin_all already exists + is correctly admin-scoped.)

-- ── 3. recurring_expense_templates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recurring_expense_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  vendor TEXT,
  day_of_month INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_materialized_period TEXT,                    -- 'YYYY-MM' dedup key (cron is idempotent)
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_recurring_expense_templates_updated ON public.recurring_expense_templates;
CREATE TRIGGER trg_recurring_expense_templates_updated BEFORE UPDATE ON public.recurring_expense_templates
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
ALTER TABLE public.recurring_expense_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_expense_templates_admin_read ON public.recurring_expense_templates;
CREATE POLICY recurring_expense_templates_admin_read ON public.recurring_expense_templates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- ── 4. contractors + payroll_payouts linkage ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,  -- optional link to a platform account
  legal_name TEXT NOT NULL,                         -- the name as it appears on the W-9
  display_name TEXT,                                -- matches payroll_payouts.person_name for rollup
  business_name TEXT,
  entity_type TEXT,                                 -- W-9 box 3 (individual/sole prop, LLC, S corp, …) — free text
  address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, zip TEXT,
  tin_last4 TEXT,                                   -- display only; never the full TIN
  w9_storage_path TEXT,                             -- private bucket
  w9_received_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_contractors_updated ON public.contractors;
CREATE TRIGGER trg_contractors_updated BEFORE UPDATE ON public.contractors
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contractors_admin_read ON public.contractors;
CREATE POLICY contractors_admin_read ON public.contractors
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- Link existing payouts to contractor rows by name (kept person_name for display).
ALTER TABLE public.payroll_payouts ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES public.contractors(id) ON DELETE SET NULL;

-- Backfill: one contractor per distinct payee name; map existing payouts onto it.
INSERT INTO public.contractors (studio_id, legal_name, display_name)
SELECT NULL, person_name, person_name
FROM (SELECT DISTINCT person_name FROM public.payroll_payouts) d
WHERE NOT EXISTS (SELECT 1 FROM public.contractors c WHERE c.display_name = d.person_name);

UPDATE public.payroll_payouts pp
SET contractor_id = c.id
FROM public.contractors c
WHERE pp.contractor_id IS NULL AND c.display_name = pp.person_name;

-- ── 5. tax_estimate_snapshots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_estimate_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,
  tax_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  ytd_revenue_cents BIGINT NOT NULL DEFAULT 0,
  ytd_expenses_cents BIGINT NOT NULL DEFAULT 0,
  ytd_net_cents BIGINT NOT NULL DEFAULT 0,
  se_tax_cents BIGINT NOT NULL DEFAULT 0,
  income_tax_cents BIGINT NOT NULL DEFAULT 0,
  suggested_payment_cents BIGINT NOT NULL DEFAULT 0,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_estimate_snapshots_period_idx
  ON public.tax_estimate_snapshots (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid), tax_year, quarter);
ALTER TABLE public.tax_estimate_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_estimate_snapshots_admin_read ON public.tax_estimate_snapshots;
CREATE POLICY tax_estimate_snapshots_admin_read ON public.tax_estimate_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- ── 6. tax_constants — rates/thresholds as DATA, never code ───────────────────
-- ⚠ SEED VALUES ARE DRAFT — must be verified against current IRS figures by a
-- CPA before launch. Annual updates are a row edit, not a deploy.
CREATE TABLE IF NOT EXISTS public.tax_constants (
  tax_year INTEGER PRIMARY KEY,
  se_net_factor NUMERIC(6,4) NOT NULL,             -- 0.9235 (92.35%)
  se_tax_rate NUMERIC(6,4) NOT NULL,               -- 0.1530 (15.3% SS+Medicare)
  ss_wage_base_cents BIGINT NOT NULL,              -- annual SS wage cap (SS portion only above this drops to Medicare)
  ss_rate NUMERIC(6,4) NOT NULL,                   -- 0.1240
  medicare_rate NUMERIC(6,4) NOT NULL,             -- 0.0290
  nineteen99_threshold_cents BIGINT NOT NULL,      -- 1099-NEC filing threshold ($600 = 60000)
  due_dates JSONB NOT NULL,                         -- {"1":"2026-04-15","2":"2026-06-15","3":"2026-09-15","4":"2027-01-15"}
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,          -- flips TRUE only after CPA sign-off
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_tax_constants_updated ON public.tax_constants;
CREATE TRIGGER trg_tax_constants_updated BEFORE UPDATE ON public.tax_constants
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
ALTER TABLE public.tax_constants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_constants_admin_read ON public.tax_constants;
CREATE POLICY tax_constants_admin_read ON public.tax_constants
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

INSERT INTO public.tax_constants
  (tax_year, se_net_factor, se_tax_rate, ss_wage_base_cents, ss_rate, medicare_rate, nineteen99_threshold_cents, due_dates, reviewed, notes)
VALUES
  (2025, 0.9235, 0.1530, 17610000, 0.1240, 0.0290, 60000,
   '{"1":"2025-04-15","2":"2025-06-16","3":"2025-09-15","4":"2026-01-15"}'::jsonb,
   FALSE, 'DRAFT seed — verify all figures + due dates against IRS before launch.'),
  (2026, 0.9235, 0.1530, 18420000, 0.1240, 0.0290, 60000,
   '{"1":"2026-04-15","2":"2026-06-15","3":"2026-09-15","4":"2027-01-15"}'::jsonb,
   FALSE, 'DRAFT seed — verify all figures + due dates against IRS before launch.')
ON CONFLICT (tax_year) DO NOTHING;

COMMENT ON TABLE public.business_tax_profiles IS 'Per-tenant tax profile (entity type, state, est. income rate). Singleton. Migration 079.';
COMMENT ON TABLE public.contractors IS 'Studio contractors for 1099 compliance. last4 + W-9 PDF only — never full TIN. Migration 079.';
COMMENT ON TABLE public.tax_constants IS 'IRS rates/thresholds/due-dates as data. reviewed=FALSE until CPA sign-off. Migration 079.';
