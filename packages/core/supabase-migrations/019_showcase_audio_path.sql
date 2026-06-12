-- Add profile_audio_path column to track the file path in profile-audio bucket
ALTER TABLE profile_audio_showcase ADD COLUMN IF NOT EXISTS profile_audio_path TEXT;
