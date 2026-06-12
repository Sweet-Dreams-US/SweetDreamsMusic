-- ============================================================
-- Beat Store Foundation Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. PROFILES: Add producer fields
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_producer'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_producer BOOLEAN DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'producer_name'
  ) THEN
    ALTER TABLE profiles ADD COLUMN producer_name TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'producer_approved_at'
  ) THEN
    ALTER TABLE profiles ADD COLUMN producer_approved_at TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================================
-- 2. BEATS: Add producer linkage, file paths, tracking columns
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'producer_id'
  ) THEN
    ALTER TABLE beats ADD COLUMN producer_id UUID REFERENCES profiles(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'trackout_file_path'
  ) THEN
    ALTER TABLE beats ADD COLUMN trackout_file_path TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'mp3_file_path'
  ) THEN
    ALTER TABLE beats ADD COLUMN mp3_file_path TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'trackout_lease_price'
  ) THEN
    ALTER TABLE beats ADD COLUMN trackout_lease_price INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'has_exclusive'
  ) THEN
    ALTER TABLE beats ADD COLUMN has_exclusive BOOLEAN DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'contains_samples'
  ) THEN
    ALTER TABLE beats ADD COLUMN contains_samples BOOLEAN DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'sample_details'
  ) THEN
    ALTER TABLE beats ADD COLUMN sample_details TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'lease_count'
  ) THEN
    ALTER TABLE beats ADD COLUMN lease_count INTEGER DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'total_lease_revenue'
  ) THEN
    ALTER TABLE beats ADD COLUMN total_lease_revenue INTEGER DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'escalation_multiplier'
  ) THEN
    ALTER TABLE beats ADD COLUMN escalation_multiplier NUMERIC DEFAULT 1.5;
  END IF;
END $$;

-- Add waveform data column for pre-generated waveform visualization
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beats' AND column_name = 'waveform_data'
  ) THEN
    ALTER TABLE beats ADD COLUMN waveform_data JSONB;
  END IF;
END $$;

-- Update beat_purchases license_type check to include trackout_lease
-- First drop the old constraint, then add new one
DO $$ BEGIN
  ALTER TABLE beat_purchases DROP CONSTRAINT IF EXISTS beat_purchases_license_type_check;
  ALTER TABLE beat_purchases ADD CONSTRAINT beat_purchases_license_type_check
    CHECK (license_type IN ('mp3_lease', 'wav_lease', 'trackout_lease', 'unlimited', 'exclusive'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not update beat_purchases constraint: %', SQLERRM;
END $$;

-- ============================================================
-- 3. PRODUCER APPLICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS producer_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  portfolio_links JSONB DEFAULT '[]',
  genre_specialties TEXT[] DEFAULT '{}',
  sample_beat_path TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE producer_applications ENABLE ROW LEVEL SECURITY;

-- Users can view their own applications
CREATE POLICY "Users can view own applications" ON producer_applications
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own applications
CREATE POLICY "Users can submit applications" ON producer_applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow unauthenticated submissions (user_id can be null)
CREATE POLICY "Anyone can submit applications" ON producer_applications
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- ============================================================
-- 4. USER SAVED BEATS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_saved_beats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  beat_id UUID REFERENCES beats(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, beat_id)
);

ALTER TABLE user_saved_beats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved beats" ON user_saved_beats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can save beats" ON user_saved_beats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unsave beats" ON user_saved_beats
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 5. USER LYRICS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_lyrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  beat_id UUID REFERENCES beats(id) NOT NULL,
  sections JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, beat_id)
);

ALTER TABLE user_lyrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lyrics" ON user_lyrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create lyrics" ON user_lyrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lyrics" ON user_lyrics
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- 6. PRODUCER PAYOUTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS producer_payouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  producer_id UUID REFERENCES profiles(id) NOT NULL,
  amount INTEGER NOT NULL, -- cents
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  stripe_transfer_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE producer_payouts ENABLE ROW LEVEL SECURITY;

-- Producers can view their own payouts
CREATE POLICY "Producers can view own payouts" ON producer_payouts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = producer_payouts.producer_id
      AND profiles.user_id = auth.uid()
    )
  );

-- ============================================================
-- 7. EXCLUSIVE PRICE ESCALATION TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION check_exclusive_price_escalation()
RETURNS TRIGGER AS $$
DECLARE
  beat_record RECORD;
  new_total_revenue INTEGER;
BEGIN
  -- Skip for exclusive purchases (they don't contribute to escalation)
  IF NEW.license_type = 'exclusive' THEN
    RETURN NEW;
  END IF;

  -- Get current beat data
  SELECT exclusive_price, escalation_multiplier, total_lease_revenue, has_exclusive
  INTO beat_record FROM beats WHERE id = NEW.beat_id;

  -- Calculate new totals
  new_total_revenue := COALESCE(beat_record.total_lease_revenue, 0) + NEW.amount_paid;

  -- Update lease count and total revenue
  UPDATE beats SET
    lease_count = COALESCE(lease_count, 0) + 1,
    total_lease_revenue = new_total_revenue
  WHERE id = NEW.beat_id;

  -- Check if we need to escalate exclusive price
  IF beat_record.has_exclusive
     AND beat_record.exclusive_price IS NOT NULL
     AND new_total_revenue >= beat_record.exclusive_price THEN
    UPDATE beats SET
      exclusive_price = CEIL(beat_record.exclusive_price * COALESCE(beat_record.escalation_multiplier, 1.5))
    WHERE id = NEW.beat_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS on_beat_purchase_escalation ON beat_purchases;
CREATE TRIGGER on_beat_purchase_escalation
  AFTER INSERT ON beat_purchases
  FOR EACH ROW
  EXECUTE FUNCTION check_exclusive_price_escalation();

-- ============================================================
-- 8. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_beats_producer_id ON beats(producer_id);
CREATE INDEX IF NOT EXISTS idx_beats_status ON beats(status);
CREATE INDEX IF NOT EXISTS idx_beats_genre ON beats(genre);
CREATE INDEX IF NOT EXISTS idx_beat_purchases_beat_id ON beat_purchases(beat_id);
CREATE INDEX IF NOT EXISTS idx_beat_purchases_buyer_id ON beat_purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_user_saved_beats_user_id ON user_saved_beats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_lyrics_user_id ON user_lyrics(user_id);
CREATE INDEX IF NOT EXISTS idx_producer_applications_status ON producer_applications(status);
CREATE INDEX IF NOT EXISTS idx_producer_payouts_producer_id ON producer_payouts(producer_id);
