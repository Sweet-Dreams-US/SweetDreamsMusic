-- 081: Tax Center owner-workflow gaps (found by the business-scenario audit).
--
-- 1. tax_payments — the ACTUAL estimated-tax payments ledger. Closes the loop:
--    suggest → owner pays IRS → records it → later quarters subtract what was
--    actually paid (not what was suggested).
CREATE TABLE IF NOT EXISTS public.tax_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,
  tax_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  paid_cents BIGINT NOT NULL CHECK (paid_cents >= 0),
  paid_on DATE NOT NULL,
  confirmation TEXT,                                -- EFTPS confirmation #, check #, etc.
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_payments_year_idx ON public.tax_payments (tax_year, quarter);
ALTER TABLE public.tax_payments ENABLE ROW LEVEL SECURITY; -- zero policies: service-role only (080 posture)

-- 2. contractors: S-corp owner guard + 1099 filing record.
--    is_owner=TRUE excludes the person from 1099 flags + the contract-labor
--    P&L line (an S corp owner's pay is NOT 1099 contract labor — the
--    misclassification a CPA screams about). filings = {"2026":"2027-01-20"}.
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS filings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. merchant_fees expense category (Schedule C Line 10 — Stripe fees were
--    invisible, silently overstating net profit unless hand-logged as Other).
ALTER TABLE public.business_expenses DROP CONSTRAINT IF EXISTS business_expenses_category_check;
ALTER TABLE public.business_expenses ADD CONSTRAINT business_expenses_category_check CHECK (
  category = ANY (ARRAY[
    'rent','utilities','equipment','software','marketing','insurance','supplies','professional_services','other',
    'advertising','contract_labor','software_subscriptions','repairs_maintenance','legal_professional','travel','meals',
    'merchant_fees'
  ]::text[])
);
