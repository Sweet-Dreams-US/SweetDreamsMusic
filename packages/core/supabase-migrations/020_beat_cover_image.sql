-- Add cover image fields to beats table
ALTER TABLE beats ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE beats ADD COLUMN IF NOT EXISTS cover_image_path TEXT;
