-- Beats table for the beat store
CREATE TABLE IF NOT EXISTS beats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  producer TEXT NOT NULL,
  genre TEXT,
  bpm INTEGER,
  musical_key TEXT,
  tags TEXT[] DEFAULT '{}',
  preview_url TEXT,
  audio_file_path TEXT,
  -- License prices in cents (null = not available for that license)
  mp3_lease_price INTEGER,
  wav_lease_price INTEGER,
  unlimited_price INTEGER,
  exclusive_price INTEGER,
  -- Status: active, sold_exclusive, inactive
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold_exclusive', 'inactive')),
  -- Exclusive buyer (if sold exclusively)
  exclusive_buyer_id UUID REFERENCES profiles(id),
  exclusive_sold_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Beat purchases / licenses sold
CREATE TABLE IF NOT EXISTS beat_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  beat_id UUID REFERENCES beats(id) NOT NULL,
  buyer_id UUID NOT NULL, -- auth.users id
  buyer_email TEXT NOT NULL,
  license_type TEXT NOT NULL CHECK (license_type IN ('mp3_lease', 'wav_lease', 'unlimited', 'exclusive')),
  amount_paid INTEGER NOT NULL, -- cents
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,
  download_url TEXT,
  download_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE beats ENABLE ROW LEVEL SECURITY;
ALTER TABLE beat_purchases ENABLE ROW LEVEL SECURITY;

-- Public can read active beats
CREATE POLICY "Public can view active beats" ON beats
  FOR SELECT USING (status = 'active');

-- Authenticated users can view their own purchases
CREATE POLICY "Users can view own purchases" ON beat_purchases
  FOR SELECT USING (auth.uid() = buyer_id);

-- Service role has full access (for admin operations)
