-- ============================================================
-- FIX: "Database error querying schema"
-- Run this in Supabase SQL Editor
-- ============================================================
-- Root cause: PostgREST can't build its schema cache because
-- triggers reference functions that may not exist, or
-- objects have broken dependencies.
-- ============================================================

-- STEP 1: Ensure update_updated_at_column() function exists
-- (Referenced by triggers on profiles, profile_projects, profile_audio_showcase)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 2: Ensure handle_new_user() trigger function exists and is correct
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
  display_name_value TEXT;
  slug_value TEXT;
  counter INTEGER := 0;
BEGIN
  user_email := COALESCE(NEW.email, 'user');
  display_name_value := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    split_part(user_email, '@', 1),
    'user'
  );

  slug_value := LOWER(REGEXP_REPLACE(display_name_value, '[^a-zA-Z0-9]', '', 'g'));
  IF slug_value = '' THEN
    slug_value := 'user';
  END IF;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE public_profile_slug = slug_value) LOOP
    counter := counter + 1;
    slug_value := LOWER(REGEXP_REPLACE(display_name_value, '[^a-zA-Z0-9]', '', 'g')) || counter::TEXT;
  END LOOP;

  BEGIN
    INSERT INTO public.profiles (user_id, display_name, public_profile_slug, email)
    VALUES (NEW.id, display_name_value, slug_value, NEW.email);
  EXCEPTION
    WHEN unique_violation THEN
      -- Profile already exists, skip
      RAISE NOTICE 'Profile already exists for user %, skipping', NEW.id;
    WHEN OTHERS THEN
      RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- STEP 3: Ensure sync_profile_email() is safe
CREATE OR REPLACE FUNCTION sync_profile_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NULL THEN
    UPDATE profiles SET email = (
      SELECT email FROM auth.users WHERE id = NEW.user_id
    ) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_sync_email ON profiles;
CREATE TRIGGER on_profile_sync_email
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_email();

-- STEP 4: Ensure all columns exist on profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role') THEN
    ALTER TABLE profiles ADD COLUMN role TEXT DEFAULT 'user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email') THEN
    ALTER TABLE profiles ADD COLUMN email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'cover_photo_url') THEN
    ALTER TABLE profiles ADD COLUMN cover_photo_url TEXT;
  END IF;
END $$;

-- STEP 5: Ensure link column exists on profile_projects
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_projects' AND column_name = 'link') THEN
    ALTER TABLE profile_projects ADD COLUMN link TEXT;
  END IF;
END $$;

-- STEP 6: Ensure is_public and is_released columns exist on profile_audio_showcase
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_audio_showcase' AND column_name = 'is_public') THEN
    ALTER TABLE profile_audio_showcase ADD COLUMN is_public BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_audio_showcase' AND column_name = 'is_released') THEN
    ALTER TABLE profile_audio_showcase ADD COLUMN is_released BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_audio_showcase' AND column_name = 'spotify_link') THEN
    ALTER TABLE profile_audio_showcase ADD COLUMN spotify_link TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_audio_showcase' AND column_name = 'apple_music_link') THEN
    ALTER TABLE profile_audio_showcase ADD COLUMN apple_music_link TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_audio_showcase' AND column_name = 'youtube_link') THEN
    ALTER TABLE profile_audio_showcase ADD COLUMN youtube_link TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_audio_showcase' AND column_name = 'soundcloud_link') THEN
    ALTER TABLE profile_audio_showcase ADD COLUMN soundcloud_link TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_audio_showcase' AND column_name = 'custom_links') THEN
    ALTER TABLE profile_audio_showcase ADD COLUMN custom_links JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- STEP 7: Recreate media_sales table safely
CREATE TABLE IF NOT EXISTS media_sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engineer_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  client_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

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
      SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('admin', 'engineer')
    )
  );

-- STEP 8: Grant permissions
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.profiles TO postgres, service_role;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profile_projects TO postgres, service_role;
GRANT SELECT ON public.profile_projects TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profile_projects TO authenticated;
GRANT ALL ON public.profile_audio_showcase TO postgres, service_role;
GRANT SELECT ON public.profile_audio_showcase TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profile_audio_showcase TO authenticated;
GRANT ALL ON public.media_sales TO postgres, service_role;
GRANT SELECT, INSERT ON public.media_sales TO authenticated;

-- STEP 9: Set engineer/admin roles
UPDATE profiles SET role = 'engineer', email = 'prvrbsounds@gmail.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'prvrbsounds@gmail.com');

UPDATE profiles SET role = 'engineer', email = 'iisszzaacc@gmail.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'iisszzaacc@gmail.com');

UPDATE profiles SET role = 'engineer', email = 'zionomari@artsaturated.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'zionomari@artsaturated.com');

UPDATE profiles SET role = 'admin', email = 'cole@sweetdreams.us'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'cole@sweetdreams.us');

UPDATE profiles SET role = 'admin', email = 'cole@marcuccilli.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'cole@marcuccilli.com');

UPDATE profiles SET role = 'admin', email = 'jayvalleo@sweetdreamsmusic.com'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'jayvalleo@sweetdreamsmusic.com');

-- STEP 10: Backfill emails
UPDATE profiles p SET email = u.email
FROM auth.users u
WHERE p.user_id = u.id AND p.email IS NULL;

-- STEP 11: Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- STEP 12: Verify everything is clean
DO $$
DECLARE
  fn_count INTEGER;
  trig_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fn_count FROM pg_proc WHERE proname = 'handle_new_user';
  SELECT COUNT(*) INTO trig_count FROM pg_trigger WHERE tgname = 'on_auth_user_created';
  RAISE NOTICE 'handle_new_user functions: %, on_auth_user_created triggers: %', fn_count, trig_count;

  SELECT COUNT(*) INTO fn_count FROM pg_proc WHERE proname = 'update_updated_at_column';
  RAISE NOTICE 'update_updated_at_column functions: %', fn_count;

  SELECT COUNT(*) INTO fn_count FROM pg_proc WHERE proname = 'sync_profile_email';
  RAISE NOTICE 'sync_profile_email functions: %', fn_count;
END $$;
