-- 047_media_booking_messages.sql
--
-- Round 8b: chat thread per media booking. The communication backbone for
-- the buyer ↔ admin ↔ engineer back-and-forth that drives package planning,
-- date negotiation, and idea sharing. Round 8c (packages) and 8d
-- (per-component scheduling) post into this same thread.
--
-- Design choices:
--   • One row per message; threads are reconstructed by `booking_id` + ORDER BY created_at
--   • author_role denormalized for fast filtering / styling without an extra join
--   • attachments JSONB carries Google Drive links + similar URL-based files
--     (per Cole's spec: no Supabase Storage uploads, URL-paste only)
--   • RLS uses SELECT-only policies; INSERTs flow through API routes that
--     verify identity + write via the service client (matches the rest of
--     media-hub's pattern in 039)
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS media_booking_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES media_bookings(id) ON DELETE CASCADE,
  author_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_role     TEXT NOT NULL CHECK (author_role IN ('admin', 'buyer', 'engineer', 'system')),
  body            TEXT NOT NULL,
  attachments     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_booking_messages_booking_idx
  ON media_booking_messages (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS media_booking_messages_author_idx
  ON media_booking_messages (author_user_id);

COMMENT ON TABLE media_booking_messages IS
  'Chat thread per media booking — buyer ↔ admin ↔ engineer back-and-forth. Round 8c+ also posts system events here (package sent, date proposed) so the thread is the unified planning surface.';
COMMENT ON COLUMN media_booking_messages.author_role IS
  'Denormalized role at message time. ''system'' is reserved for automated posts (date proposals, package versions, etc.).';
COMMENT ON COLUMN media_booking_messages.attachments IS
  'Array of { label, url, kind: image|video|file|link }. URL-based only — Google Drive/Dropbox/external. No file uploads.';

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Service role bypasses RLS. SELECT policies define who can READ a message.
-- INSERTS happen exclusively through API routes (verify identity → service
-- client write). This mirrors the rest of media_hub.
ALTER TABLE media_booking_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_booking_messages_buyer_read ON media_booking_messages;
CREATE POLICY media_booking_messages_buyer_read ON media_booking_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM media_bookings mb
      WHERE mb.id = media_booking_messages.booking_id
        AND mb.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS media_booking_messages_band_read ON media_booking_messages;
CREATE POLICY media_booking_messages_band_read ON media_booking_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM media_bookings mb
      JOIN band_members bm ON bm.band_id = mb.band_id
      WHERE mb.id = media_booking_messages.booking_id
        AND bm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS media_booking_messages_admin_read ON media_booking_messages;
CREATE POLICY media_booking_messages_admin_read ON media_booking_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS media_booking_messages_engineer_read ON media_booking_messages;
CREATE POLICY media_booking_messages_engineer_read ON media_booking_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM media_session_bookings s
      WHERE s.parent_booking_id = media_booking_messages.booking_id
        AND s.engineer_id = auth.uid()
    )
  );
