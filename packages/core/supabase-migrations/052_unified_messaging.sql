-- 052_unified_messaging.sql
--
-- Round 9a: unified messaging — three thread types
-- (sweet_dreams, media_booking, producer_dm) with one messages table.
--
-- Round 8b's media_booking_messages stays in place (read-only safety
-- net) until Round 9b swaps the API over. New code reads/writes the
-- new tables; old table is preserved for rollback safety + audit.
--
-- Idempotent. Safe to re-run.

-- ────────────────────────────────────────────────────────────────────
-- 1. message_threads — one row per conversation
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL
                    CHECK (kind IN ('sweet_dreams', 'media_booking', 'producer_dm')),
  owner_user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  media_booking_id  UUID REFERENCES media_bookings(id) ON DELETE CASCADE,
  subject           TEXT,
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_threads_kind_fk CHECK (
    (kind = 'sweet_dreams'  AND owner_user_id IS NOT NULL AND media_booking_id IS NULL) OR
    (kind = 'media_booking' AND media_booking_id IS NOT NULL AND owner_user_id IS NULL) OR
    (kind = 'producer_dm'   AND owner_user_id IS NOT NULL AND media_booking_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS message_threads_one_sweet_dreams_per_user
  ON message_threads (owner_user_id) WHERE kind = 'sweet_dreams';

CREATE UNIQUE INDEX IF NOT EXISTS message_threads_one_per_booking
  ON message_threads (media_booking_id) WHERE kind = 'media_booking';

CREATE INDEX IF NOT EXISTS message_threads_owner_recent_idx
  ON message_threads (owner_user_id, last_message_at DESC)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_threads_kind_idx
  ON message_threads (kind);

-- ────────────────────────────────────────────────────────────────────
-- 2. message_thread_participants — who can read + their last_read_at
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_thread_participants (
  thread_id     UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_thread_participants_user_idx
  ON message_thread_participants (user_id);

-- ────────────────────────────────────────────────────────────────────
-- 3. messages — unified message rows
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  author_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_role     TEXT NOT NULL
                  CHECK (author_role IN ('admin', 'buyer', 'engineer', 'producer', 'system')),
  kind            TEXT NOT NULL DEFAULT 'chat'
                  CHECK (kind IN ('chat', 'update', 'booking_notification')),
  body            TEXT,
  attachments     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_thread_recent_idx
  ON messages (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_author_idx
  ON messages (author_user_id) WHERE author_user_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 4. Trigger: keep message_threads.last_message_at in sync
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_messages_update_thread_recency()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE message_threads
     SET last_message_at = NEW.created_at
   WHERE id = NEW.thread_id
     AND last_message_at < NEW.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_update_thread_recency ON messages;
CREATE TRIGGER messages_update_thread_recency
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION trg_messages_update_thread_recency();

-- ────────────────────────────────────────────────────────────────────
-- 5. Trigger: auto-create Sweet Dreams thread on profile creation
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_profiles_create_sweet_dreams_thread()
RETURNS TRIGGER AS $$
DECLARE
  new_thread_id UUID;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM message_threads
    WHERE kind = 'sweet_dreams' AND owner_user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO message_threads (kind, owner_user_id, subject)
  VALUES ('sweet_dreams', NEW.user_id, 'Sweet Dreams Music')
  RETURNING id INTO new_thread_id;
  INSERT INTO message_thread_participants (thread_id, user_id, role)
  VALUES (new_thread_id, NEW.user_id, 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_create_sweet_dreams_thread ON profiles;
CREATE TRIGGER profiles_create_sweet_dreams_thread
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profiles_create_sweet_dreams_thread();

-- ────────────────────────────────────────────────────────────────────
-- 6. Backfill — create Sweet Dreams threads for every existing user
-- ────────────────────────────────────────────────────────────────────
INSERT INTO message_threads (kind, owner_user_id, subject)
SELECT 'sweet_dreams', p.user_id, 'Sweet Dreams Music'
FROM profiles p
WHERE p.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM message_threads mt
    WHERE mt.kind = 'sweet_dreams' AND mt.owner_user_id = p.user_id
  );

INSERT INTO message_thread_participants (thread_id, user_id, role)
SELECT mt.id, mt.owner_user_id, 'owner'
FROM message_threads mt
WHERE mt.kind = 'sweet_dreams'
  AND mt.owner_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM message_thread_participants p
    WHERE p.thread_id = mt.id AND p.user_id = mt.owner_user_id
  );

-- ────────────────────────────────────────────────────────────────────
-- 7. Backfill — booking threads + their messages from media_booking_messages
-- ────────────────────────────────────────────────────────────────────
INSERT INTO message_threads (kind, media_booking_id, subject, last_message_at, created_at)
SELECT
  'media_booking',
  mbm.booking_id,
  'Booking conversation',
  MAX(mbm.created_at),
  MIN(mbm.created_at)
FROM media_booking_messages mbm
WHERE NOT EXISTS (
  SELECT 1 FROM message_threads mt
  WHERE mt.kind = 'media_booking' AND mt.media_booking_id = mbm.booking_id
)
GROUP BY mbm.booking_id;

INSERT INTO messages (id, thread_id, author_user_id, author_role, kind, body, attachments, created_at)
SELECT
  mbm.id,
  mt.id,
  mbm.author_user_id,
  mbm.author_role,
  CASE WHEN mbm.author_role = 'system' THEN 'update' ELSE 'chat' END,
  mbm.body,
  mbm.attachments,
  mbm.created_at
FROM media_booking_messages mbm
JOIN message_threads mt
  ON mt.kind = 'media_booking' AND mt.media_booking_id = mbm.booking_id
WHERE NOT EXISTS (
  SELECT 1 FROM messages m WHERE m.id = mbm.id
);

-- ────────────────────────────────────────────────────────────────────
-- 8. RLS — three thread types, three permission models
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_thread_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS threads_sweet_dreams_owner_read ON message_threads;
CREATE POLICY threads_sweet_dreams_owner_read ON message_threads
  FOR SELECT TO authenticated
  USING (kind = 'sweet_dreams' AND owner_user_id = auth.uid());

DROP POLICY IF EXISTS threads_sweet_dreams_staff_read ON message_threads;
CREATE POLICY threads_sweet_dreams_staff_read ON message_threads
  FOR SELECT TO authenticated
  USING (
    kind = 'sweet_dreams'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'engineer')
    )
  );

DROP POLICY IF EXISTS threads_booking_buyer_read ON message_threads;
CREATE POLICY threads_booking_buyer_read ON message_threads
  FOR SELECT TO authenticated
  USING (
    kind = 'media_booking'
    AND EXISTS (
      SELECT 1 FROM media_bookings mb
      WHERE mb.id = message_threads.media_booking_id AND mb.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS threads_booking_band_read ON message_threads;
CREATE POLICY threads_booking_band_read ON message_threads
  FOR SELECT TO authenticated
  USING (
    kind = 'media_booking'
    AND EXISTS (
      SELECT 1 FROM media_bookings mb
      JOIN band_members bm ON bm.band_id = mb.band_id
      WHERE mb.id = message_threads.media_booking_id AND bm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS threads_booking_staff_read ON message_threads;
CREATE POLICY threads_booking_staff_read ON message_threads
  FOR SELECT TO authenticated
  USING (
    kind = 'media_booking'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'engineer')
    )
  );

DROP POLICY IF EXISTS threads_booking_engineer_read ON message_threads;
CREATE POLICY threads_booking_engineer_read ON message_threads
  FOR SELECT TO authenticated
  USING (
    kind = 'media_booking'
    AND EXISTS (
      SELECT 1 FROM media_session_bookings s
      WHERE s.parent_booking_id = message_threads.media_booking_id
        AND s.engineer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS threads_dm_participants_read ON message_threads;
CREATE POLICY threads_dm_participants_read ON message_threads
  FOR SELECT TO authenticated
  USING (
    kind = 'producer_dm'
    AND EXISTS (
      SELECT 1 FROM message_thread_participants p
      WHERE p.thread_id = message_threads.id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS participants_self_read ON message_thread_participants;
CREATE POLICY participants_self_read ON message_thread_participants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS participants_admin_read ON message_thread_participants;
CREATE POLICY participants_admin_read ON message_thread_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS messages_thread_visible_read ON messages;
CREATE POLICY messages_thread_visible_read ON messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM message_threads mt WHERE mt.id = messages.thread_id)
  );
