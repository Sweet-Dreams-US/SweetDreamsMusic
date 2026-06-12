-- Add links jsonb column to profile_projects for multi-platform links
ALTER TABLE profile_projects ADD COLUMN IF NOT EXISTS links jsonb DEFAULT '{}'::jsonb;
