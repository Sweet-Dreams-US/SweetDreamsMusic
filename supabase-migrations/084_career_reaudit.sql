-- 084: Career Path re-audit fixes.
--
-- 1. Normalize booking emails so the completed-sessions gate (.eq lowercased)
--    matches historical mixed-case rows. 6 live rows differ from lower(); the
--    booking write paths already lowercase, this catches the legacy ones.
UPDATE public.bookings SET customer_email = lower(customer_email)
  WHERE customer_email IS NOT NULL AND customer_email <> lower(customer_email);

-- 2. Lock down the play-count RPC: it is SECURITY DEFINER, so without an
--    explicit grant it is anon-callable via PostgREST /rpc and could pump
--    play_count on any link UUID, bypassing the route's revoked/expired check.
--    Route calls it through the service client, so only service_role needs it.
REVOKE EXECUTE ON FUNCTION public.increment_share_play(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_share_play(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_share_play(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_share_play(uuid) TO service_role;
ALTER FUNCTION public.increment_share_play(uuid) SET search_path = '';

-- 3. Shows: the semi-verification spine (calendar entry predates the show)
--    lived in client-writable columns — shows RLS is FOR ALL TO authenticated,
--    so an artist with the anon key could raw-insert a row with a backdated
--    created_at + confirmed_at set + is_headline=true and pass the gate without
--    a real show. Pin the verification columns at the DB layer:
--      • created_at is ALWAYS now() on insert (can't backdate the "logged
--        before" proof — so a past show_date can never look pre-dated).
--      • confirmed_at can't be set on INSERT (confirmation must come through the
--        PATCH route, which already blocks future-dated confirms).
CREATE OR REPLACE FUNCTION public.shows_pin_verification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := NOW();
  NEW.confirmed_at := NULL;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS shows_pin_verification_trg ON public.shows;
CREATE TRIGGER shows_pin_verification_trg
  BEFORE INSERT ON public.shows
  FOR EACH ROW EXECUTE FUNCTION public.shows_pin_verification();
