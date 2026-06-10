-- 076: Inbox rebuild — permission-matrix messaging (Plan 4).
--
-- EXPAND-ONLY migration. The plan called for renaming kinds in place
-- (sweet_dreams → studio, producer_dm → dm), but this DB serves running prod
-- code that queries those literals — renames would break main instantly. So:
-- existing kinds stay; a new generic 'dm' kind is ADDED (owner-less, membership
-- purely via message_thread_participants); 'sweet_dreams' IS the studio thread
-- (relabeled in UI only); legacy 'producer_dm' rows (zero exist live) are read
-- as dm synonyms. Contract/cleanup can happen long after cutover.
--
-- The permission matrix itself lives in lib/messaging-matrix.ts — ALL message
-- writes in this app go through role-gated API routes on the service client
-- (RLS here is SELECT-only defense-in-depth, verified 052), so a SQL matrix
-- function would be dead code that drifts. RLS below only extends READ access
-- to the new kind. NO new triggers (the 062 signup-chain guard polices those).

-- 1. Allow the generic 'dm' thread kind.
ALTER TABLE public.message_threads DROP CONSTRAINT IF EXISTS message_threads_kind_check;
ALTER TABLE public.message_threads ADD CONSTRAINT message_threads_kind_check CHECK (
  kind = ANY (ARRAY['sweet_dreams'::text, 'media_booking'::text, 'producer_dm'::text, 'dm'::text])
);

ALTER TABLE public.message_threads DROP CONSTRAINT IF EXISTS message_threads_kind_fk;
ALTER TABLE public.message_threads ADD CONSTRAINT message_threads_kind_fk CHECK (
  (kind = 'sweet_dreams'  AND owner_user_id IS NOT NULL AND media_booking_id IS NULL) OR
  (kind = 'media_booking' AND media_booking_id IS NOT NULL AND owner_user_id IS NULL) OR
  (kind = 'producer_dm'   AND owner_user_id IS NOT NULL AND media_booking_id IS NULL) OR
  -- Generic DM: no owner, no booking — participants are the membership.
  (kind = 'dm'            AND owner_user_id IS NULL AND media_booking_id IS NULL)
);

-- 2. Media managers are staff senders in the matrix.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_author_role_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_author_role_check CHECK (
  author_role = ANY (ARRAY['admin'::text, 'buyer'::text, 'engineer'::text, 'producer'::text, 'media_manager'::text, 'system'::text])
);

-- 3. Broadcast linkage: fanned-out messages carry the audit-row id, so a blast
-- is traceable while replies stay ordinary studio-thread conversation.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES public.admin_broadcasts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_broadcast_idx ON public.messages (broadcast_id) WHERE broadcast_id IS NOT NULL;

-- 4. admin_broadcasts keeps its audit role, now segment-aware + thread-aware.
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS audience_segment TEXT;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS thread_delivery BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS email_delivery BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS sender_role TEXT;
ALTER TABLE public.admin_broadcasts ADD COLUMN IF NOT EXISTS sender_user_id UUID;

-- 5. Unread-nudge dedup: at most one nudge email per thread per day.
ALTER TABLE public.message_threads ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ;

-- 6. RLS: participants of a generic dm can read it (mirrors the producer_dm
-- policy; messages policy already follows thread visibility).
DROP POLICY IF EXISTS threads_generic_dm_participants_read ON public.message_threads;
CREATE POLICY threads_generic_dm_participants_read ON public.message_threads
  FOR SELECT TO authenticated
  USING (
    kind = 'dm' AND EXISTS (
      SELECT 1 FROM public.message_thread_participants p
      WHERE p.thread_id = message_threads.id AND p.user_id = auth.uid()
    )
  );

COMMENT ON COLUMN public.messages.broadcast_id IS
  'Set on messages fanned out from a broadcast (admin_broadcasts.id). Replies are normal messages. Migration 076.';
COMMENT ON COLUMN public.message_threads.last_nudge_at IS
  'Last unread-nudge email for this thread (cron dedup: max one per thread per day). Migration 076.';
