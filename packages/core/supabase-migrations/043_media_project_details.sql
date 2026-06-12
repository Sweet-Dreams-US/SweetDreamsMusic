-- 043_media_project_details.sql
--
-- Round 5 / multi-page media booking flow surfaced a project-details
-- questionnaire (project name, songs breakdown, vibe references, cover
-- art name targets, shorts targets, etc.). The shape is intentionally
-- loose JSONB because it varies by offering — slot-aware rendering
-- only shows fields the offering's components.slots actually need.
--
-- Stored verbatim on each media_bookings row at checkout time so admin
-- + engineers can see exactly what the buyer told us at order time
-- without joining anything. Survives offering schema changes.
--
-- Reference shape (NOT enforced — JSONB is intentionally permissive):
-- {
--   "project_name": string,
--   "songs_breakdown": [{ "title": string, "notes": string? }],
--   "songs": string?,                      // legacy single-string fallback
--   "vibe_references": string,
--   "cover_art_name": string?,             // only if offering has cover_art slot
--   "shorts_song_targets": string?,        // only if offering has shorts slot
--   "additional_notes": string?
-- }
--
-- Idempotent.

ALTER TABLE media_bookings
  ADD COLUMN IF NOT EXISTS project_details JSONB;

COMMENT ON COLUMN media_bookings.project_details IS
  'Buyer-provided project questionnaire snapshot at order time. Slot-aware shape — see lib/media-config.ts for the keys each offering type uses.';
