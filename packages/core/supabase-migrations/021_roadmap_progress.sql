-- Add roadmap_progress JSONB column to profiles for tracking artist roadmap completion
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS roadmap_progress JSONB DEFAULT '{}';
