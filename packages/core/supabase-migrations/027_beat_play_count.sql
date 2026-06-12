-- Track how many times a beat preview has been played
ALTER TABLE beats ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0;
