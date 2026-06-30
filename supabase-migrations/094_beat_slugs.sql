-- 094_beat_slugs.sql
-- Readable, typeable URLs for beat pages: /beats/<slug> instead of /beats/<uuid>.
-- Adds a slug column, backfills from title (collision-safe), and enforces uniqueness.
-- Old UUID URLs keep working — the route resolves slug-or-id and 308-redirects
-- a UUID hit to its canonical slug.

ALTER TABLE beats ADD COLUMN IF NOT EXISTS slug text;

-- Backfill: derive a base slug from the title, append -2/-3/... on any collision
-- (checked against ALL existing slugs so cross-title collisions can't happen).
DO $$
DECLARE
  r RECORD;
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN SELECT id, title FROM beats WHERE slug IS NULL ORDER BY created_at NULLS LAST, id LOOP
    base := NULLIF(trim(both '-' from regexp_replace(lower(coalesce(r.title, '')), '[^a-z0-9]+', '-', 'g')), '');
    IF base IS NULL THEN base := 'beat'; END IF;
    base := left(base, 60);
    base := trim(both '-' from base);
    IF base = '' THEN base := 'beat'; END IF;
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM beats WHERE slug = candidate) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    UPDATE beats SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS beats_slug_unique ON beats (slug) WHERE slug IS NOT NULL;
