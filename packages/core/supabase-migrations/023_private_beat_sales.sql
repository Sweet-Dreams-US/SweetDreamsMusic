-- Private Beat Sales: support unlisted beats, private sales, and recording external sales
-- All three scenarios converge into beat_purchases for accounting compatibility

-- 1. Create private_beat_sales table
CREATE TABLE IF NOT EXISTS private_beat_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id UUID REFERENCES beats(id) ON DELETE SET NULL, -- nullable for "record sale" with no beat in DB
  token TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  buyer_name TEXT,
  buyer_email TEXT NOT NULL,
  license_type TEXT NOT NULL CHECK (license_type IN ('mp3_lease', 'trackout_lease', 'exclusive')),
  amount INTEGER NOT NULL DEFAULT 0, -- in cents, 0 = free
  payment_method TEXT NOT NULL DEFAULT 'stripe' CHECK (payment_method IN ('stripe', 'cash', 'venmo', 'zelle', 'other', 'free')),
  requires_payment BOOLEAN NOT NULL DEFAULT true,
  beat_title TEXT NOT NULL,
  beat_producer TEXT NOT NULL,
  producer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'paid', 'completed', 'expired', 'cancelled')),
  signed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  agreement_text TEXT,
  agreement_ip TEXT,
  agreement_user_agent TEXT,
  stripe_checkout_session_id TEXT,
  purchase_id UUID REFERENCES beat_purchases(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_private_beat_sales_token ON private_beat_sales(token);
CREATE INDEX idx_private_beat_sales_created_by ON private_beat_sales(created_by);
CREATE INDEX idx_private_beat_sales_status ON private_beat_sales(status);
CREATE INDEX idx_private_beat_sales_buyer_email ON private_beat_sales(buyer_email);

-- 2. Add columns to beat_purchases for private sale tracking
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'stripe';
ALTER TABLE beat_purchases ADD COLUMN IF NOT EXISTS private_sale_id UUID REFERENCES private_beat_sales(id) ON DELETE SET NULL;

-- 3. Allow 'unlisted' status on beats
-- (The existing check constraint may or may not exist; handle both cases)
DO $$ BEGIN
  ALTER TABLE beats DROP CONSTRAINT IF EXISTS beats_status_check;
  ALTER TABLE beats ADD CONSTRAINT beats_status_check
    CHECK (status IN ('active', 'pending_review', 'sold_exclusive', 'inactive', 'unlisted'));
EXCEPTION WHEN OTHERS THEN
  -- If no constraint exists, just add one
  NULL;
END $$;

-- 4. RLS policies
ALTER TABLE private_beat_sales ENABLE ROW LEVEL SECURITY;

-- Admins can do everything (via service role)
CREATE POLICY "Service role full access on private_beat_sales" ON private_beat_sales
  FOR ALL USING (true) WITH CHECK (true);

-- Producers can view their own private sales
CREATE POLICY "Producers view own private sales" ON private_beat_sales
  FOR SELECT USING (
    created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    OR producer_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- Producers can create private sales
CREATE POLICY "Producers create private sales" ON private_beat_sales
  FOR INSERT WITH CHECK (
    created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );
