-- 033_events.sql
--
-- Phase 5 — Events + admin broadcast "Announce Event" template.
--
-- Architecture:
--
--   events         — the event itself (title, time, location, visibility, media)
--   event_rsvps    — one row per (event, person) capturing the entire lifecycle:
--                    'requested' → admin approves → 'going'
--                    'invited'   → person accepts  → 'going' / 'maybe' / 'not_going'
--                    direct self-RSVP on a public event  → 'going' immediately
--
-- Visibility model — three states, as promised by the existing
-- app/events/page.tsx placeholder comment:
--
--   public          — listed on /events, anyone can RSVP directly
--   private_listed  — listed on /events, visitors can REQUEST to attend
--                     (admin approves → going); admin can also invite directly
--   private_hidden  — NOT listed on /events; visible only via direct
--                     invitation email (token link) or by logged-in users
--                     who were invited (row in event_rsvps with status='invited')
--
-- Admin broadcast announcements reuse the existing `admin_broadcasts` table
-- (migration 026) with template_key='event_announcement'. No new table needed
-- for that — the announcement body is free-form HTML rendered from event data.
--
-- RLS strategy mirrors the bands migration (031): RLS enabled, "service role
-- full access" policy for parity. Writes always go through the service client
-- in API routes that verify admin / ownership in the app layer.

-- ============================================================
-- events
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,

  -- Display
  title TEXT NOT NULL,
  tagline TEXT,            -- short one-liner shown in list cards
  description TEXT,        -- longer body shown on the detail page
  cover_image_url TEXT,

  -- When + where
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ,
  location  TEXT,          -- free-form: "Sweet Dreams Studio A", an address, or TBA

  -- Visibility — see header comment
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private_listed', 'private_hidden')),

  -- Capacity limit. NULL = unlimited. When set, RSVPs beyond this count can
  -- be accepted at app-layer discretion (e.g. waitlist) — the DB doesn't enforce.
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),

  -- Cancellation — kept separate from deletion so the page can render a
  -- "cancelled" state and past attendees still see it in their dashboard.
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  cancellation_reason TEXT,

  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_listed
  ON events(starts_at)
  WHERE visibility IN ('public', 'private_listed') AND NOT is_cancelled;

-- ============================================================
-- event_rsvps
-- ============================================================
CREATE TABLE IF NOT EXISTS event_rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Either user_id (self-RSVP by logged-in user) OR invited_email (admin
  -- invited someone who may not have an account yet). When someone is invited
  -- by email and later signs up, a future migration or nightly job can link
  -- the user_id by matching email — for now, the invitation accept flow does
  -- the linking at claim time.
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email  TEXT,
  invited_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Status — see header comment for the state machine
  status TEXT NOT NULL CHECK (status IN ('requested', 'invited', 'going', 'maybe', 'not_going')),

  -- Opaque token for email-based invitation accept links. Only set when
  -- status='invited' AND invited_email IS NOT NULL. Cleared after response.
  token TEXT UNIQUE,

  -- Optional attendee message — required when status='requested' (they tell
  -- admin why they want to come), optional otherwise.
  message TEXT,

  -- Number of additional guests. 0 = just this person; does not include them.
  guest_count INTEGER NOT NULL DEFAULT 0 CHECK (guest_count >= 0),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,

  -- A row must identify WHO it's for — either a user or an email.
  CONSTRAINT event_rsvp_identity_required CHECK (
    user_id IS NOT NULL OR invited_email IS NOT NULL
  )
);

-- One RSVP per (event, user) when user_id is set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_rsvps_user
  ON event_rsvps(event_id, user_id)
  WHERE user_id IS NOT NULL;

-- One invitation per (event, email) when it's an email-only row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_rsvps_email
  ON event_rsvps(event_id, LOWER(invited_email))
  WHERE invited_email IS NOT NULL AND user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_status ON event_rsvps(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_token
  ON event_rsvps(token) WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user_all
  ON event_rsvps(user_id) WHERE user_id IS NOT NULL;

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_events_updated_at();

-- ============================================================
-- RLS — match bands-migration pattern (service role owns writes; reads
-- are broad and filtered at the query layer). The app layer enforces the
-- "hidden" part of private_hidden events by never selecting them for
-- anonymous visitors on the public /events page.
-- ============================================================
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on events"
  ON events FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on event_rsvps"
  ON event_rsvps FOR ALL USING (true) WITH CHECK (true);
