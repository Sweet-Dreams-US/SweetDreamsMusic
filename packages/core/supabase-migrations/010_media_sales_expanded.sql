-- Expand media_sales table with role tracking
ALTER TABLE media_sales ADD COLUMN IF NOT EXISTS sale_type TEXT DEFAULT 'video';
ALTER TABLE media_sales ADD COLUMN IF NOT EXISTS sold_by TEXT;
ALTER TABLE media_sales ADD COLUMN IF NOT EXISTS filmed_by TEXT;
ALTER TABLE media_sales ADD COLUMN IF NOT EXISTS edited_by TEXT;
ALTER TABLE media_sales ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE media_sales ADD COLUMN IF NOT EXISTS sale_amount INTEGER DEFAULT 0;

-- sale_amount = what the client paid (amount field already exists as the total)
-- engineer_name stays as the primary engineer (backward compat)
-- sold_by = who brought in / sold the deal (gets 15% commission)
-- filmed_by = who filmed it
-- edited_by = who edited it

-- Allow service role full access
DROP POLICY IF EXISTS "Service role full access on media_sales" ON media_sales;
CREATE POLICY "Service role full access on media_sales" ON media_sales
  FOR ALL USING (true) WITH CHECK (true);
