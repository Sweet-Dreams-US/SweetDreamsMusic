-- 085: Tax Center v2 — OBBBA / 2026 rules (Plan 5 v2).
-- The law lives in tax_constants rows, never in code: OBBBA's inflation
-- indexing means each new tax year is a data update, not a deploy.
--
-- ⚠ All seeds remain reviewed=false (DRAFT) — the CPA gate from v1 still
-- holds: estimates banner + dormant reminders until a CPA signs off.

-- ── 1. tax_constants: QBI + per-year deductibility + Sec 179 display values ──
ALTER TABLE public.tax_constants ADD COLUMN IF NOT EXISTS qbi_pct NUMERIC;                       -- 20 (permanent under OBBBA)
ALTER TABLE public.tax_constants ADD COLUMN IF NOT EXISTS qbi_min_deduction_cents BIGINT;        -- $400 minimum (2026+)
ALTER TABLE public.tax_constants ADD COLUMN IF NOT EXISTS qbi_min_qbi_floor_cents BIGINT;        -- requires $1,000+ active QBI
ALTER TABLE public.tax_constants ADD COLUMN IF NOT EXISTS deductible_pcts JSONB NOT NULL DEFAULT '{}'::jsonb; -- category → pct overrides for the year
ALTER TABLE public.tax_constants ADD COLUMN IF NOT EXISTS sec179_limit_cents BIGINT;             -- display/lesson value
ALTER TABLE public.tax_constants ADD COLUMN IF NOT EXISTS sec179_phaseout_cents BIGINT;

-- 2025 payments: 1099 threshold stays $600; staff meals still 50%.
UPDATE public.tax_constants SET
  qbi_pct = 20,
  qbi_min_deduction_cents = NULL,           -- $400 minimum starts 2026
  qbi_min_qbi_floor_cents = NULL,
  deductible_pcts = '{"meals_clients": 50, "meals_staff": 50, "entertainment": 0, "meals": 50}'::jsonb,
  sec179_limit_cents = 250000000,           -- $2.5M
  sec179_phaseout_cents = 400000000,        -- $4M
  notes = COALESCE(notes,'') || ' | OBBBA: 100% bonus depreciation permanent (post Jan 19 2025). 1099 threshold $600 for 2025 payments.'
WHERE tax_year = 2025;

-- 2026 payments: 1099 threshold $2,000 (indexed from 2027); staff meals 0%;
-- QBI $400 minimum active.
UPDATE public.tax_constants SET
  nineteen99_threshold_cents = 200000,      -- $2,000 — OBBBA (was wrongly seeded $600)
  qbi_pct = 20,
  qbi_min_deduction_cents = 40000,          -- $400
  qbi_min_qbi_floor_cents = 100000,         -- $1,000 active QBI
  deductible_pcts = '{"meals_clients": 50, "meals_staff": 0, "entertainment": 0, "meals": 50}'::jsonb,
  sec179_limit_cents = 256000000,           -- $2.56M
  sec179_phaseout_cents = 409000000,        -- $4.09M
  notes = COALESCE(notes,'') || ' | OBBBA: 1099 threshold $2,000 for 2026 payments (indexed from 2027, nearest $100). Staff meals 0% from 2026 (TCJA disallowance). QBI 20% permanent + $400 min with $1,000+ QBI.'
WHERE tax_year = 2026;

-- ── 2. Profile: QBI toggle (owner-set; default on — phase-outs start ~$400K
--     joint, far above typical studio income; the assumptions sheet says so) ──
ALTER TABLE public.business_tax_profiles ADD COLUMN IF NOT EXISTS apply_qbi BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 3. Expenses: the three-way meals/entertainment split (teaching UX) ──────
-- Legacy 'meals' rows stay valid and read as meals_clients.
ALTER TABLE public.business_expenses DROP CONSTRAINT IF EXISTS business_expenses_category_check;
ALTER TABLE public.business_expenses ADD CONSTRAINT business_expenses_category_check CHECK (
  category = ANY (ARRAY[
    'rent','utilities','equipment','software','marketing','insurance','supplies','professional_services','other',
    'advertising','contract_labor','software_subscriptions','repairs_maintenance','legal_professional','travel','meals',
    'merchant_fees',
    'meals_clients','meals_staff','entertainment'
  ]::text[])
);

-- ── 4. Contractors: voluntary 1099 issuance below threshold ─────────────────
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS voluntary_1099 BOOLEAN NOT NULL DEFAULT FALSE;
