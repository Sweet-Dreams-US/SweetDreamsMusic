-- 058_package_salesperson.sql
--
-- Optional salesperson attribution + commission on package quotes.
--
-- Per Cole: memberships and package quotes should NOT carry a sales
-- percentage by default. Only when an admin explicitly attributes a
-- salesperson and sets their commission % does any commission apply.
--
-- Model:
--   • Salesperson + pct live on the QUOTE (a quote is a specific sale
--     to a specific customer — the natural home for "who closed it").
--     Templates stay clean reusable menus with no salesperson baked in.
--   • Commission is EARNED ON PAYMENT — when the entitlement mints
--     (customer paid, webhook fired), we snapshot the commission
--     amount onto the entitlement. This matches how session + media
--     pay work: you earn when the money is in the door, not at
--     quote-acceptance.
--   • Snapshotting the cents onto the entitlement (vs. recomputing
--     from the quote) freezes the number — later quote edits can't
--     retroactively change a salesperson's earned payroll.
--
-- All four columns are nullable. NULL salesperson = no commission,
-- which is the default for every existing quote + entitlement.

ALTER TABLE public.package_quotes
  ADD COLUMN IF NOT EXISTS salesperson_name TEXT,
  ADD COLUMN IF NOT EXISTS sales_commission_pct NUMERIC
    CHECK (sales_commission_pct IS NULL OR (sales_commission_pct >= 0 AND sales_commission_pct <= 100));

ALTER TABLE public.package_entitlements
  ADD COLUMN IF NOT EXISTS salesperson_name TEXT,
  ADD COLUMN IF NOT EXISTS sales_commission_cents INTEGER
    CHECK (sales_commission_cents IS NULL OR sales_commission_cents >= 0);

-- Index entitlements by salesperson so the payroll query (which groups
-- package commissions per person) stays fast as the table grows.
CREATE INDEX IF NOT EXISTS package_entitlements_salesperson_idx
  ON public.package_entitlements (salesperson_name)
  WHERE salesperson_name IS NOT NULL;
