-- ============================================================
-- Engineer System Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add role column to profiles (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE profiles ADD COLUMN role TEXT DEFAULT 'user';
  END IF;
END $$;

-- 2. Add requested_engineer column to bookings (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'requested_engineer'
  ) THEN
    ALTER TABLE bookings ADD COLUMN requested_engineer TEXT;
  END IF;
END $$;

-- 3. Add claimed_at column to bookings (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'claimed_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN claimed_at TIMESTAMPTZ;
  END IF;
END $$;

-- 4. Add email column to profiles for easy lookup (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE profiles ADD COLUMN email TEXT;
  END IF;
END $$;

-- 5. Add cover_photo_url to profiles (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'cover_photo_url'
  ) THEN
    ALTER TABLE profiles ADD COLUMN cover_photo_url TEXT;
  END IF;
END $$;

-- 5b. Add link column to profile_projects (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profile_projects' AND column_name = 'link'
  ) THEN
    ALTER TABLE profile_projects ADD COLUMN link TEXT;
  END IF;
END $$;

-- 6. Create media_sales table for engineer media commission tracking
CREATE TABLE IF NOT EXISTS media_sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engineer_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL, -- in cents
  client_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- 6. Set engineer roles
-- PRVRB
UPDATE profiles SET role = 'engineer', email = 'prvrbsounds@gmail.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'prvrbsounds@gmail.com');

-- Iszac
UPDATE profiles SET role = 'engineer', email = 'iisszzaacc@gmail.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'iisszzaacc@gmail.com');

-- Zion (Z)
UPDATE profiles SET role = 'engineer', email = 'zionomari@artsaturated.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'zionomari@artsaturated.com');

-- 7. Set admin roles
UPDATE profiles SET role = 'admin', email = 'cole@sweetdreams.us'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'cole@sweetdreams.us');

UPDATE profiles SET role = 'admin', email = 'cole@marcuccilli.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'cole@marcuccilli.com');

UPDATE profiles SET role = 'admin', email = 'jayvalleo@sweetdreamsmusic.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'jayvalleo@sweetdreamsmusic.com');

-- 8. RLS for media_sales
ALTER TABLE media_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Engineers can view own media sales" ON media_sales;
CREATE POLICY "Engineers can view own media sales" ON media_sales
  FOR SELECT USING (
    engineer_name = (
      SELECT display_name FROM profiles WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can insert media sales" ON media_sales;
CREATE POLICY "Admins can insert media sales" ON media_sales
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'engineer'
    )
  );

-- 9. Update profiles trigger to copy email on insert
CREATE OR REPLACE FUNCTION sync_profile_email()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles SET email = (
    SELECT email FROM auth.users WHERE id = NEW.user_id
  ) WHERE id = NEW.id AND email IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_sync_email ON profiles;
CREATE TRIGGER on_profile_sync_email
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_email();

-- 10. Backfill email for existing profiles
UPDATE profiles p SET email = u.email
FROM auth.users u
WHERE p.user_id = u.id AND p.email IS NULL;
