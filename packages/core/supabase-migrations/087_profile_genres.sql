-- 087_profile_genres.sql
-- Multi-genre support: a profile can carry several genres (Cole, 2026-06-19).
-- Additive + safe: adds genres text[] and backfills from the existing single `genre`.
-- The single `genre` column is kept (written through as genres[0]) for back-compat.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS genres text[] NOT NULL DEFAULT '{}';

UPDATE profiles
  SET genres = ARRAY[genre]
  WHERE genre IS NOT NULL AND btrim(genre) <> '' AND genres = '{}';
