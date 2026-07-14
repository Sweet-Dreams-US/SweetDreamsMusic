-- 100_studio_half_hour_add.sql
-- Half-hour add-on pricing. Studio sessions now run in 30-min steps (min 1hr);
-- each trailing 30 min adds a FLAT fee (plus pro-rated night/same-day/guest
-- surcharges, computed in code). Cole 2026-07: Studio A $35, Studio B $25.
--
-- The code (lib/studio-config-server.ts rowToConfig) falls back to
-- round(hourly_rate_cents / 2) when this column is null, which equals the seeded
-- values ($35 = $70/2, $25 = $50/2) — so pricing is safe even mid-migration.

ALTER TABLE studio_rooms ADD COLUMN IF NOT EXISTS half_hour_add_cents integer;

UPDATE studio_rooms SET half_hour_add_cents = 3500 WHERE slug = 'studio_a' AND half_hour_add_cents IS NULL;
UPDATE studio_rooms SET half_hour_add_cents = 2500 WHERE slug = 'studio_b' AND half_hour_add_cents IS NULL;
-- Any other/future rooms: default to half the hourly rate (matches the code fallback).
UPDATE studio_rooms SET half_hour_add_cents = round(hourly_rate_cents / 2.0) WHERE half_hour_add_cents IS NULL;
