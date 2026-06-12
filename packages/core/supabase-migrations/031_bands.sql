-- 031_bands.sql
--
-- The band hub: bands live alongside solo user profiles but have their own
-- identity, public page, membership, and (in a later phase) bookings.
--
-- Architecture:
--
--   bands           — the band entity (slug, profile fields, visibility)
--   band_members    — M:N between auth.users and bands, carries role + permission flags
--   band_invites    — pending email-based invitations with expiry
--
-- Permission model: role (owner / admin / member) AS THE BROAD TIER plus per-member
-- flags the band owner toggles individually. A member can have no flags on = pure
-- viewer who just shows up on the public page. The owner always has all flags
-- implicitly; we still store them as true for consistency in the UI.
--
-- Phase 3 will add band_bookings + band_booking_payments tables that reference
-- this one. The `can_book_band_sessions` flag gates who can create/contribute
-- to those bookings.
--
-- RLS is enabled but all authoritative operations go through the service
-- client in the app layer (getSessionUser + lib/bands.ts permission helpers).
-- This matches the pattern established in 009_studio_blocks.sql and later.

-- ============================================================
-- bands
-- ============================================================
CREATE TABLE IF NOT EXISTS bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT,
  profile_picture_url TEXT,
  cover_image_url TEXT,
  genre TEXT,
  hometown TEXT,

  -- Social links — mirrors profiles schema so the UI can be shared
  spotify_link TEXT,
  apple_music_link TEXT,
  instagram_link TEXT,
  facebook_link TEXT,
  youtube_link TEXT,
  soundcloud_link TEXT,
  tiktok_link TEXT,
  twitter_link TEXT,
  custom_links JSONB,

  -- Visibility: public means /bands/[slug] resolves; otherwise 404.
  -- A private band is still usable for band hub/booking but not discoverable.
  is_public BOOLEAN NOT NULL DEFAULT true,

  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bands_slug ON bands(slug);
CREATE INDEX IF NOT EXISTS idx_bands_created_by ON bands(created_by);

-- ============================================================
-- band_members
-- ============================================================
CREATE TABLE IF NOT EXISTS band_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id UUID NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Role is the broad tier. Permission flags are the fine-grained knobs.
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),

  -- Display name override for band context (e.g. stage name different from profile name).
  -- Falls back to the solo profile display_name when null.
  stage_name TEXT,

  -- Instrument / role within the band (bass, lead guitar, vocals, etc.).
  band_role TEXT,

  -- Per-permission flags. Owner always has all of these implicitly, but the
  -- column values still reflect that for a clean UI.
  can_edit_public_page      BOOLEAN NOT NULL DEFAULT false,
  can_book_sessions         BOOLEAN NOT NULL DEFAULT false,
  can_book_band_sessions    BOOLEAN NOT NULL DEFAULT false,
  can_manage_members        BOOLEAN NOT NULL DEFAULT false,

  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A user can only be in a given band once.
  UNIQUE(band_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_band_members_band ON band_members(band_id);
CREATE INDEX IF NOT EXISTS idx_band_members_user ON band_members(user_id);

-- Guardrail: exactly one owner per band. Enforced via partial unique index
-- rather than a trigger to keep this cheap on reads.
CREATE UNIQUE INDEX IF NOT EXISTS idx_band_members_one_owner_per_band
  ON band_members(band_id) WHERE role = 'owner';

-- ============================================================
-- band_invites
-- ============================================================
CREATE TABLE IF NOT EXISTS band_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id UUID NOT NULL REFERENCES bands(id) ON DELETE CASCADE,

  -- Invited by email — they may or may not have a Sweet Dreams account yet.
  -- We lookup by email at acceptance time.
  invited_email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Random opaque token used in the accept URL (/bands/accept/[token]).
  token TEXT UNIQUE NOT NULL,

  -- What role + permissions the invite grants. `owner` can never be invited —
  -- ownership transfer is a separate explicit operation.
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  can_edit_public_page      BOOLEAN NOT NULL DEFAULT false,
  can_book_sessions         BOOLEAN NOT NULL DEFAULT false,
  can_book_band_sessions    BOOLEAN NOT NULL DEFAULT false,
  can_manage_members        BOOLEAN NOT NULL DEFAULT false,

  -- Optional stage name / band role pre-populated by the inviter.
  stage_name TEXT,
  band_role TEXT,

  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_band_invites_band ON band_invites(band_id);
CREATE INDEX IF NOT EXISTS idx_band_invites_email ON band_invites(LOWER(invited_email));
CREATE INDEX IF NOT EXISTS idx_band_invites_token ON band_invites(token);

-- Only one ACTIVE invite per (band, email) at a time. Re-sending from the UI
-- should cancel and recreate, not duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_band_invites_one_active_per_email
  ON band_invites(band_id, LOWER(invited_email))
  WHERE accepted_at IS NULL AND rejected_at IS NULL;

-- ============================================================
-- updated_at trigger for bands
-- ============================================================
CREATE OR REPLACE FUNCTION update_bands_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bands_updated_at ON bands;
CREATE TRIGGER bands_updated_at
  BEFORE UPDATE ON bands
  FOR EACH ROW
  EXECUTE FUNCTION update_bands_updated_at();

-- ============================================================
-- RLS — enable and allow service-role full access (app layer enforces).
-- ============================================================
ALTER TABLE bands         ENABLE ROW LEVEL SECURITY;
ALTER TABLE band_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE band_invites  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on bands"
  ON bands FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on band_members"
  ON band_members FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on band_invites"
  ON band_invites FOR ALL USING (true) WITH CHECK (true);
