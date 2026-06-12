-- 078: SECURITY — lock down payroll_payouts RLS (applied to prod 2026-06-10).
--
-- payroll_payouts (a dashboard-created table, never in repo migrations) shipped
-- with TWO permissive policies — "Admins can manage payouts" and "Service role
-- payroll_payouts" — both FOR ALL TO public with USING(true) WITH CHECK(true).
-- "TO public" covers the anon + authenticated roles, so ANY caller holding the
-- site's anon key (which is embedded in the client bundle) could read or write
-- every staff member's name + pay amount + method directly via PostgREST.
--
-- The app never relied on those policies: app/api/admin/payouts/route.ts is
-- admin-gated and uses createServiceClient(), which bypasses RLS entirely. So
-- the fix is simply to remove the open policies and grant ONLY an admin-scoped
-- SELECT (mirroring expenses_admin_all on business_expenses). No write policy
-- is needed — the service role bypasses RLS; anon/authenticated get nothing.

DROP POLICY IF EXISTS "Admins can manage payouts" ON public.payroll_payouts;
DROP POLICY IF EXISTS "Service role payroll_payouts" ON public.payroll_payouts;

DROP POLICY IF EXISTS payroll_payouts_admin_read ON public.payroll_payouts;
CREATE POLICY payroll_payouts_admin_read ON public.payroll_payouts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));
