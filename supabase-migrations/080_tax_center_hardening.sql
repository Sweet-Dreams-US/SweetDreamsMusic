-- 080: Tax Center hardening — owner-only privacy + review-fleet fixes.
--
-- 1. PRIVACY (per Cole): tax/financial tables are SERVICE-ROLE ONLY. The
--    admin-read SELECT policies from 079 keyed off profiles.role='admin', which
--    is grantable in the Users tab — broader than "the studio owners". All app
--    reads go through admin-gated service-client routes (gated on the
--    SUPER_ADMINS email roster via getUserRole), so client-side SELECT is pure
--    attack surface. RLS stays ENABLED with ZERO policies = deny-by-default
--    for anon + authenticated; the service role bypasses RLS.
DROP POLICY IF EXISTS business_tax_profiles_admin_read ON public.business_tax_profiles;
DROP POLICY IF EXISTS recurring_expense_templates_admin_read ON public.recurring_expense_templates;
DROP POLICY IF EXISTS contractors_admin_read ON public.contractors;
DROP POLICY IF EXISTS tax_estimate_snapshots_admin_read ON public.tax_estimate_snapshots;
DROP POLICY IF EXISTS tax_constants_admin_read ON public.tax_constants;
-- business_expenses had a pre-existing FOR ALL admin policy — same argument.
DROP POLICY IF EXISTS expenses_admin_all ON public.business_expenses;

-- 2. FIX (review finding, critical): the COALESCE expression unique index can't
--    be targeted by PostgREST's onConflict — snapshot upserts errored (estimates
--    route swallowed it; the reminder cron would re-send). Replace with a plain
--    UNIQUE NULLS NOT DISTINCT constraint (PG15+), which onConflict
--    'studio_id,tax_year,quarter' resolves correctly even with NULL studio_id.
DROP INDEX IF EXISTS tax_estimate_snapshots_period_idx;
ALTER TABLE public.tax_estimate_snapshots
  DROP CONSTRAINT IF EXISTS tax_estimate_snapshots_period_key;
ALTER TABLE public.tax_estimate_snapshots
  ADD CONSTRAINT tax_estimate_snapshots_period_key
  UNIQUE NULLS NOT DISTINCT (studio_id, tax_year, quarter);

-- 3. FIX (business-sim finding): business_expenses shipped with a HIDDEN
--    dashboard-era CHECK whose category list predates the Tax Center —
--    'software_subscriptions' and 'meals' (among others) were rejected at
--    insert. Widen to the union of the old values (kept valid) + the
--    Schedule-C set in lib/tax.ts. Same dashboard-CHECK gotcha as the
--    booking-status incident — found by running the owner simulation.
ALTER TABLE public.business_expenses DROP CONSTRAINT IF EXISTS business_expenses_category_check;
ALTER TABLE public.business_expenses ADD CONSTRAINT business_expenses_category_check CHECK (
  category = ANY (ARRAY[
    'rent','utilities','equipment','software','marketing','insurance','supplies','professional_services','other',
    'advertising','contract_labor','software_subscriptions','repairs_maintenance','legal_professional','travel','meals'
  ]::text[])
);
