-- ============================================================
-- Migration 036 — RSVP-with-capacity-check RPC.
--
-- Problem: /api/events/[slug]/rsvp reads capacity and count separately,
-- then upserts. Two simultaneous "Going" clicks when exactly one seat
-- remains both pass the check and both succeed. Event goes over capacity
-- with no signal to admin.
--
-- Fix: move the read-check-write sequence into a PL/pgSQL function that
-- locks the event row with SELECT ... FOR UPDATE. Postgres serializes
-- concurrent transactions against the same event, so the count + capacity
-- comparison is atomic per event.
--
-- Semantics:
--   - Capacity is only enforced when the NEW status is 'going' AND event
--     has a non-null capacity.
--   - The current user's existing RSVP row is excluded from the count —
--     i.e. switching from 'going' (with 2 guests) to 'going' (with 5 guests)
--     evaluates "current count excluding me" + 1 + 5, not double-counting me.
--   - Other statuses (maybe / not_going / requested / invited) bypass the
--     capacity check because they don't consume seats.
--   - Visibility rules (public vs private_listed) stay in the route handler;
--     this RPC only handles capacity and the actual row mutation.
-- ============================================================

CREATE OR REPLACE FUNCTION rsvp_with_capacity_check(
  p_event_id     UUID,
  p_user_id      UUID,
  p_status       TEXT,
  p_message      TEXT,
  p_guest_count  INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity           INT;
  v_is_cancelled       BOOLEAN;
  v_current_attendees  INT;
  v_rsvp_id            UUID;
BEGIN
  -- Lock the event row. Concurrent RPC calls against the same event.id
  -- block here until the prior transaction commits.
  SELECT capacity, is_cancelled
    INTO v_capacity, v_is_cancelled
    FROM events
    WHERE id = p_event_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND',  'error', 'Event not found');
  END IF;

  IF v_is_cancelled THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CANCELLED',  'error', 'Event was cancelled');
  END IF;

  -- Only check capacity for 'going' status when a cap is set.
  IF p_status = 'going' AND v_capacity IS NOT NULL THEN
    -- Sum of (1 + guest_count) across all CURRENT 'going' rows, excluding
    -- this user's own row (they might be updating it).
    SELECT COALESCE(SUM(1 + COALESCE(guest_count, 0)), 0)
      INTO v_current_attendees
      FROM event_rsvps
      WHERE event_id = p_event_id
        AND status   = 'going'
        AND user_id IS DISTINCT FROM p_user_id;

    IF v_current_attendees + 1 + COALESCE(p_guest_count, 0) > v_capacity THEN
      RETURN jsonb_build_object(
        'ok',      false,
        'code',    'CAPACITY_FULL',
        'error',   'Event is at capacity',
        'current', v_current_attendees,
        'capacity', v_capacity
      );
    END IF;
  END IF;

  -- Upsert the RSVP row.
  SELECT id INTO v_rsvp_id
    FROM event_rsvps
    WHERE event_id = p_event_id AND user_id = p_user_id;

  IF v_rsvp_id IS NOT NULL THEN
    UPDATE event_rsvps
      SET status       = p_status,
          message      = NULLIF(p_message, ''),
          guest_count  = COALESCE(p_guest_count, 0),
          responded_at = NOW()
      WHERE id = v_rsvp_id;
  ELSE
    INSERT INTO event_rsvps (event_id, user_id, status, message, guest_count, responded_at)
    VALUES (
      p_event_id,
      p_user_id,
      p_status,
      NULLIF(p_message, ''),
      COALESCE(p_guest_count, 0),
      NOW()
    )
    RETURNING id INTO v_rsvp_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'rsvp_id', v_rsvp_id, 'status', p_status);
END;
$$;

-- Grant execute to service_role only — this RPC is called from the API
-- route using the service client. Public anon users never call it directly.
REVOKE ALL ON FUNCTION rsvp_with_capacity_check FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION rsvp_with_capacity_check TO service_role;
