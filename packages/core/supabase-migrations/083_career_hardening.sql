-- 083: Career Path hardening (adversarial-review fixes).
--
-- 1. xp_log dedup is enforced in the DB now, not just check-then-insert in
--    awardXP — closes the concurrency double-XP window when two event hooks
--    fire for the same (user, action, reference_id) at once. Dedupe any
--    existing dupes first, then a partial UNIQUE index.
DELETE FROM public.xp_log a USING public.xp_log b
  WHERE a.ctid < b.ctid
    AND a.user_id = b.user_id AND a.action = b.action
    AND a.reference_id IS NOT NULL AND a.reference_id = b.reference_id;
CREATE UNIQUE INDEX IF NOT EXISTS xp_log_user_action_ref_uniq
  ON public.xp_log (user_id, action, reference_id)
  WHERE reference_id IS NOT NULL;

-- 2. Atomic play-count increment for /api/listen (lost-update fix). SECURITY
--    DEFINER so the unauthenticated route can call it via the service client.
CREATE OR REPLACE FUNCTION public.increment_share_play(p_link_id UUID)
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.track_share_links SET play_count = play_count + 1
  WHERE id = p_link_id RETURNING play_count;
$$;

-- 3. Per-listener play dedup: one counted play per (link, listener key) per day.
--    Raw play_count still increments for the artist's vanity stat; the
--    GATE/achievement signal uses distinct listener keys instead.
CREATE TABLE IF NOT EXISTS public.track_share_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id UUID NOT NULL REFERENCES public.track_share_links(id) ON DELETE CASCADE,
  listener_key TEXT NOT NULL,            -- hashed IP + day bucket
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS track_share_plays_uniq
  ON public.track_share_plays (share_link_id, listener_key);
ALTER TABLE public.track_share_plays ENABLE ROW LEVEL SECURITY;  -- routes only

-- 4. Persist computed stage so catalog edits / cross-call transitions fire
--    onStageUp off a durable baseline (not just the intra-call previousStage).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS career_stage_computed INTEGER NOT NULL DEFAULT 0;
