-- 039_media_hub.sql
-- Media Booking Hub — Phase A bedrock.
--
-- Six tables that together implement the catalog, the package configurator,
-- the "gift card" credit balance, the one-time discount codes, the parallel
-- media booking calendar, and the link table that lets credits redeem against
-- existing studio bookings WITHOUT modifying the live booking system.
--
-- Spec: SweetDreamsMusicVault/Features/Media-Booking-Hub.md
-- Snapshot rule (per Platform/Commission-Splits): split_breakdown JSON is
-- written at transaction time. Never recompute from "current" rates.

-- ============================================================================
-- 1. media_offerings — catalog (standalone services + package definitions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS media_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('standalone', 'package')),
  eligibility TEXT NOT NULL
    CHECK (eligibility IN ('solo', 'band', 'both', 'band-by-request')),

  -- Pricing: either single price OR a range. Both NULL = "inquire for pricing"
  -- (Sweet Spot Individual + by-request packages).
  price_cents INTEGER,
  price_range_low_cents INTEGER,
  price_range_high_cents INTEGER,

  -- Configurator schema for packages: declares slots, severity options, and
  -- skip rules. Standalone services leave this NULL.
  components JSONB,

  -- Studio recording hours flowed to the credit bank on package purchase.
  -- 0 for non-package offerings or packages that don't include studio time.
  studio_hours_included NUMERIC(6,2) NOT NULL DEFAULT 0,

  -- Public marketing copy used on /media (price-free surface).
  public_blurb TEXT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_offerings_active_sort_idx
  ON media_offerings(is_active, sort_order);
CREATE INDEX IF NOT EXISTS media_offerings_kind_eligibility_idx
  ON media_offerings(kind, eligibility);

-- ============================================================================
-- 2. media_bookings — purchases and inquiries (parent record per engagement)
-- ============================================================================
CREATE TABLE IF NOT EXISTS media_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES media_offerings(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Set when the purchase is on a band's behalf. Credits + deliverables then
  -- attach to the band, not the buyer's individual account.
  band_id UUID REFERENCES bands(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'inquiry'
    CHECK (status IN ('inquiry','deposited','scheduled','in_production','delivered','cancelled')),

  -- Snapshot of the configurator wizard's choices (severity tiers, skipped
  -- items). Used to render the "what you bought" recap and run delivery.
  configured_components JSONB,

  final_price_cents INTEGER NOT NULL,
  deposit_cents INTEGER,

  -- Stripe wiring
  stripe_payment_intent_id TEXT,
  stripe_session_id TEXT,
  deposit_paid_at TIMESTAMPTZ,
  final_paid_at TIMESTAMPTZ,

  -- Snapshotted commission split per Platform/Commission-Splits.
  -- Media deliveries follow 15/50/35 (platform / editor / coordinator).
  split_breakdown JSONB,

  notes_to_us TEXT,
  -- URLs of final deliverables as production lands (videos, photos, art).
  deliverables JSONB,

  -- One-time discount code minted at checkout. FK added below once the
  -- discount table is created.
  discount_code_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_bookings_user_idx ON media_bookings(user_id);
CREATE INDEX IF NOT EXISTS media_bookings_band_idx
  ON media_bookings(band_id) WHERE band_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_bookings_status_idx ON media_bookings(status);
CREATE INDEX IF NOT EXISTS media_bookings_stripe_pi_idx
  ON media_bookings(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ============================================================================
-- 3. studio_credits — "gift card" balance (deferred-revenue ledger)
-- ============================================================================
-- Cole, 2026-04-24: "accounting should show a balance of what we can call
-- gift cards — value where we have been paid and the session still needs to
-- happen. Engineer is paid when the session happens, not when money comes in."
-- Therefore: revenue recognized at sale, credit liability sits on the books
-- until session completion drains it. No expiration.
CREATE TABLE IF NOT EXISTS studio_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner: exactly one of user_id / band_id (XOR enforced below).
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  band_id UUID REFERENCES bands(id) ON DELETE CASCADE,

  source_booking_id UUID REFERENCES media_bookings(id) ON DELETE SET NULL,

  hours_granted NUMERIC(6,2) NOT NULL CHECK (hours_granted >= 0),
  hours_used NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (hours_used >= 0),
  -- hours_remaining derived: (hours_granted - hours_used). Computed at query
  -- time so we never have to keep two columns in sync.

  -- Reserved for future "expires after N months" mode. NULL = no expiry,
  -- which is current policy.
  expires_at TIMESTAMPTZ,

  -- Cost basis for the deferred-liability accounting view. Equals the portion
  -- of media_bookings.final_price_cents allocated to the studio-time slot.
  cost_basis_cents INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT studio_credits_owner_xor CHECK (
    (user_id IS NOT NULL AND band_id IS NULL) OR
    (user_id IS NULL AND band_id IS NOT NULL)
  ),
  CONSTRAINT studio_credits_used_lte_granted CHECK (hours_used <= hours_granted)
);

CREATE INDEX IF NOT EXISTS studio_credits_user_idx
  ON studio_credits(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS studio_credits_band_idx
  ON studio_credits(band_id) WHERE band_id IS NOT NULL;
-- For the admin "deferred liability" view, surface only credits with balance.
CREATE INDEX IF NOT EXISTS studio_credits_outstanding_idx
  ON studio_credits((hours_granted - hours_used)) WHERE (hours_granted - hours_used) > 0;

-- ============================================================================
-- 4. media_discount_codes — one-time codes minted per package purchase
-- ============================================================================
-- Default applies_to = 'media' = 15% off any future media add-on. The "breaking
-- up sessions" framing from Cole — encourages return visits for extras.
CREATE TABLE IF NOT EXISTS media_discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,

  source_booking_id UUID NOT NULL REFERENCES media_bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  discount_kind TEXT NOT NULL CHECK (discount_kind IN ('percent', 'flat')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),

  applies_to TEXT NOT NULL DEFAULT 'media'
    CHECK (applies_to IN ('media','studio','beats','any')),

  redeemed_at TIMESTAMPTZ,
  -- Soft pointer — redeeming booking can live in media_bookings or studio
  -- bookings depending on applies_to. We resolve at read time.
  redeemed_on_booking_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_discount_codes_user_idx
  ON media_discount_codes(user_id);
CREATE INDEX IF NOT EXISTS media_discount_codes_unredeemed_idx
  ON media_discount_codes(user_id) WHERE redeemed_at IS NULL;

ALTER TABLE media_bookings
  ADD CONSTRAINT media_bookings_discount_code_fk
  FOREIGN KEY (discount_code_id) REFERENCES media_discount_codes(id) ON DELETE SET NULL;

-- ============================================================================
-- 5. media_session_bookings — separate calendar for filming + photo + meetings
-- ============================================================================
-- Cole, 2026-04-24: "Booking these things should be its own version of the
-- booking system, but in the media hub, and not affecting the regular music
-- booking system. Calendars overlap, but we have to specify where the filming
-- is at — Jay does music videos, so he won't be available, but if filming is
-- outside the studio, Iszac/Zion/PRVRB can still take sessions."
--
-- Conflict model: engineer + location. 'studio' blocks the room AND engineer.
-- 'external' blocks only the engineer.
CREATE TABLE IF NOT EXISTS media_session_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_booking_id UUID NOT NULL REFERENCES media_bookings(id) ON DELETE CASCADE,

  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,

  location TEXT NOT NULL CHECK (location IN ('studio', 'external')),
  external_location_text TEXT,

  -- Engineers identified through profiles.role = 'engineer'. We FK to
  -- auth.users to keep this stable across role changes.
  engineer_id UUID NOT NULL REFERENCES auth.users(id),

  session_kind TEXT NOT NULL DEFAULT 'video'
    CHECK (session_kind IN ('video','photo','recording','mixing','storyboard','marketing-meeting','other')),

  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_progress','completed','cancelled')),

  -- Snapshotted media split (15/50/35 default). Stays attached even if rates
  -- change later — past sessions pay out at contract terms.
  split_breakdown JSONB,

  -- Engineer payout state. Triggered at completion, not at parent deposit.
  engineer_payout_cents INTEGER,
  engineer_payout_paid_at TIMESTAMPTZ,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT media_session_bookings_time_valid CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS media_session_bookings_parent_idx
  ON media_session_bookings(parent_booking_id);
CREATE INDEX IF NOT EXISTS media_session_bookings_engineer_time_idx
  ON media_session_bookings(engineer_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS media_session_bookings_location_time_idx
  ON media_session_bookings(location, starts_at, ends_at);

-- ============================================================================
-- 6. studio_credit_redemptions — link table to existing studio bookings
-- ============================================================================
-- The "don't touch the live booking flow" pattern. Existing booking writes
-- happen exactly as today. The media hub UI optionally creates a redemption
-- row that links a credit to that booking and decrements hours_used. The live
-- /book and /dashboard/bands flows never need to know credits exist.
--
-- Soft pointer to studio_booking_id (no hard FK) keeps this loosely coupled —
-- if the underlying bookings table ever migrates, this side table doesn't
-- block it.
CREATE TABLE IF NOT EXISTS studio_credit_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id UUID NOT NULL REFERENCES studio_credits(id) ON DELETE RESTRICT,

  studio_booking_id UUID NOT NULL,
  hours_redeemed NUMERIC(6,2) NOT NULL CHECK (hours_redeemed > 0),

  redeemed_by UUID NOT NULL REFERENCES auth.users(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS studio_credit_redemptions_credit_idx
  ON studio_credit_redemptions(credit_id);
CREATE INDEX IF NOT EXISTS studio_credit_redemptions_booking_idx
  ON studio_credit_redemptions(studio_booking_id);

-- ============================================================================
-- updated_at triggers (reuses pattern across tables)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_offerings_updated_at ON media_offerings;
CREATE TRIGGER media_offerings_updated_at BEFORE UPDATE ON media_offerings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS media_bookings_updated_at ON media_bookings;
CREATE TRIGGER media_bookings_updated_at BEFORE UPDATE ON media_bookings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS media_session_bookings_updated_at ON media_session_bookings;
CREATE TRIGGER media_session_bookings_updated_at BEFORE UPDATE ON media_session_bookings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================================
-- RLS — read policies. Writes go through API routes with service role.
-- ============================================================================
ALTER TABLE media_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_session_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_credit_redemptions ENABLE ROW LEVEL SECURITY;

-- Active offerings are public — both /media (no prices) and /dashboard/media
-- (full prices) read this. Inactive rows hidden from everyone except the
-- service role.
DROP POLICY IF EXISTS media_offerings_public_read ON media_offerings;
CREATE POLICY media_offerings_public_read ON media_offerings
  FOR SELECT USING (is_active = TRUE);

-- Bookings: owner OR (if band-attached) any band member. Admin uses service role.
DROP POLICY IF EXISTS media_bookings_owner_read ON media_bookings;
CREATE POLICY media_bookings_owner_read ON media_bookings
  FOR SELECT USING (
    user_id = auth.uid()
    OR (band_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM band_members
      WHERE band_members.band_id = media_bookings.band_id
        AND band_members.user_id = auth.uid()
    ))
  );

-- Credits: same ownership model. Bands' credits are spendable by any member.
DROP POLICY IF EXISTS studio_credits_owner_read ON studio_credits;
CREATE POLICY studio_credits_owner_read ON studio_credits
  FOR SELECT USING (
    user_id = auth.uid()
    OR (band_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM band_members
      WHERE band_members.band_id = studio_credits.band_id
        AND band_members.user_id = auth.uid()
    ))
  );

-- Discount codes: only the artist who got it. Bands don't share codes.
DROP POLICY IF EXISTS media_discount_codes_owner_read ON media_discount_codes;
CREATE POLICY media_discount_codes_owner_read ON media_discount_codes
  FOR SELECT USING (user_id = auth.uid());

-- Session bookings: assigned engineer OR parent-booking owner OR band members.
DROP POLICY IF EXISTS media_session_bookings_visible_read ON media_session_bookings;
CREATE POLICY media_session_bookings_visible_read ON media_session_bookings
  FOR SELECT USING (
    engineer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM media_bookings mb
      WHERE mb.id = media_session_bookings.parent_booking_id
        AND (
          mb.user_id = auth.uid()
          OR (mb.band_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM band_members bm
            WHERE bm.band_id = mb.band_id AND bm.user_id = auth.uid()
          ))
        )
    )
  );

-- Redemptions: only the redeemer. Read-only audit trail.
DROP POLICY IF EXISTS studio_credit_redemptions_owner_read ON studio_credit_redemptions;
CREATE POLICY studio_credit_redemptions_owner_read ON studio_credit_redemptions
  FOR SELECT USING (redeemed_by = auth.uid());

-- ============================================================================
-- SEED DATA — canonical offerings, v1 (2026-04-24)
-- ============================================================================
-- Prices below are placeholders editable in admin without redeploys. Cole
-- will dial them in once the admin CRUD ships in the next session. Standalone
-- prices ARE confirmed (shorts $80/$130/$200, MV mid $500, MV premium range,
-- marketing $80/hr or $60/hr block). Package prices are derived from line
-- items minus a bundle discount and round to the nearest $50 for friendliness.

-- ---- Stand-alone services -------------------------------------------------
INSERT INTO media_offerings
  (slug, title, description, kind, eligibility, price_cents,
   price_range_low_cents, price_range_high_cents, public_blurb, sort_order)
VALUES
  ('short-basic', 'Short — Basic',
   'A single short-form clip — Reels/TikTok ready. Simple shoot, fast turnaround.',
   'standalone', 'both', 8000, NULL, NULL,
   'Single vertical clip, fast turnaround, ready to post.', 10),

  ('short-mid', 'Short — Mid',
   'Higher production value. Multiple angles, light grading, tighter edit.',
   'standalone', 'both', 13000, NULL, NULL,
   'A more polished short with multiple angles and edit work.', 11),

  ('short-premium', 'Short — Premium',
   'A mini music video. Storyboarded, multi-shot, full edit + color.',
   'standalone', 'both', 20000, NULL, NULL,
   'Basically a mini music video — storyboarded, multi-shot, fully edited.', 12),

  ('mv-mid', 'Mid-Tier Music Video',
   'A full music video with light planning. Single concept, full edit.',
   'standalone', 'both', 50000, NULL, NULL,
   'Full music video, light planning, single concept.', 20),

  ('mv-premium', 'Premium Music Video',
   'Full storyboard plotting every scene, camera move, and editing style across the song. Marketing input included. Plus we cut it into 5+ shorts for free.',
   'standalone', 'both', NULL, 150000, 500000,
   'Full storyboard, multi-location, marketing planning. Plus free shorts cut from the master.', 21),

  ('photo-session', 'Photo Session',
   'Studio photo session for cover art, press kit, and social posts.',
   'standalone', 'both', 20000, NULL, NULL,
   'Studio photos for cover art and post content.', 30),

  ('cover-art', 'Cover Art (Single)',
   'Custom cover art for one release.',
   'standalone', 'both', 15000, NULL, NULL,
   'Custom cover art for a single release.', 31),

  ('marketing-plan-hourly', 'Marketing Plan — Hourly',
   'Hourly marketing planning: content schedules, release rollout, budget recommendations.',
   'standalone', 'both', 8000, NULL, NULL,
   'Marketing strategy by the hour.', 40),

  ('marketing-plan-block', 'Marketing Plan — 4-Hour Block',
   'Four hours of marketing planning at a discounted block rate.',
   'standalone', 'both', 24000, NULL, NULL,
   'Four hours of marketing strategy at a block discount.', 41);

-- ---- Studio packages ------------------------------------------------------
INSERT INTO media_offerings
  (slug, title, description, kind, eligibility, price_cents,
   components, studio_hours_included, public_blurb, sort_order)
VALUES
  ('package-single-drop', 'Single Drop',
   'Record, mix, master, and roll out one song with cover art, shorts, and a photo session.',
   'package', 'solo', 85000,
   '{"slots":[
      {"key":"recording_hours","kind":"hours","value":3,"label":"Studio recording (3 hrs)","skippable":false},
      {"key":"mix_master","kind":"unit","count":1,"label":"Mix + master","skippable":false},
      {"key":"cover_art","kind":"unit","count":1,"label":"Cover art","skippable":true,"skip_delta_cents":15000},
      {"key":"shorts","kind":"unit","count":3,"label":"3 shorts","options":[
        {"tier":"basic","delta":0},
        {"tier":"mid","delta":15000},
        {"tier":"premium","delta":36000}
      ]},
      {"key":"photo_session","kind":"unit","count":1,"label":"Photo session","skippable":true,"skip_delta_cents":20000}
   ]}'::jsonb,
   3,
   'One-song release, all-in. Recording, mix, master, cover art, 3 shorts, and a photo session.',
   100),

  ('package-ep', 'EP Package',
   'EP-scale production: recording, four mixed tracks, cover art, 12 shorts, a music video, and photo content.',
   'package', 'solo', 250000,
   '{"slots":[
      {"key":"recording_hours","kind":"hours","value":6,"label":"Studio recording (6 hrs)","skippable":false},
      {"key":"mix_master","kind":"unit","count":4,"label":"4 mixes + masters","skippable":false},
      {"key":"cover_art","kind":"unit","count":1,"label":"Main cover art","skippable":true,"skip_delta_cents":15000},
      {"key":"shorts","kind":"unit","count":12,"label":"12 shorts","options":[
        {"tier":"basic","delta":0},
        {"tier":"mid","delta":60000},
        {"tier":"premium","delta":144000}
      ]},
      {"key":"music_video","kind":"unit","count":1,"label":"1 music video","options":[
        {"tier":"basic","delta":0},
        {"tier":"premium","delta":100000}
      ]},
      {"key":"photo_sessions","kind":"unit","count":2,"label":"2 photo sessions","skippable":true,"skip_delta_cents":40000}
   ]}'::jsonb,
   6,
   'Full EP rollout: recording, four masters, cover art, 12 shorts, a music video, and two photo sessions.',
   101),

  ('package-album', 'Album Package',
   'Album-scale production with multiple cover concepts, deep short rotation, and music videos.',
   'package', 'solo', 550000,
   '{"slots":[
      {"key":"recording_hours","kind":"hours","value":20,"label":"Studio recording (20 hrs)","skippable":false},
      {"key":"mix_master","kind":"unit","count":1,"label":"Full album mix + master","skippable":false},
      {"key":"main_cover","kind":"unit","count":1,"label":"Main album cover","skippable":false},
      {"key":"single_covers","kind":"unit","count":2,"label":"2 single cover arts","skippable":true,"skip_delta_cents":30000},
      {"key":"shorts_per_song","kind":"per_song","count_per":2.5,"label":"2–3 shorts per song","options":[
        {"tier":"basic","delta":0},
        {"tier":"mid","delta":150000},
        {"tier":"premium","delta":360000}
      ]},
      {"key":"music_videos","kind":"unit","count":2,"label":"2–3 music videos","options":[
        {"tier":"basic","delta":0},
        {"tier":"premium","delta":200000}
      ]},
      {"key":"photo_per_shoot","kind":"on_shoot","label":"Picture posts from every shoot","skippable":false}
   ]}'::jsonb,
   20,
   'Full album: 20 hrs recording, mix + master, main cover + single covers, multiple shorts per song, music videos, and ongoing photo content.',
   102),

  ('package-sweet-spot-individual', 'Sweet Spot — Individual',
   'A custom album-scale program for a solo artist. Inquire for scope and pricing.',
   'package', 'solo', NULL,
   '{"slots":[
      {"key":"recording_hours","kind":"flexible","label":"Recording — as many hours as needed for the album","skippable":false},
      {"key":"mix_master","kind":"unit","count":1,"label":"Full mix + master","skippable":false},
      {"key":"main_cover","kind":"unit","count":1,"label":"Main album cover","skippable":false},
      {"key":"single_covers","kind":"unit","count":3,"label":"3 single cover arts","skippable":false},
      {"key":"music_videos","kind":"unit","count":4,"label":"4+ music videos","skippable":false},
      {"key":"shorts_per_song","kind":"per_song","count_per":3,"label":"3+ shorts per song","skippable":false},
      {"key":"photo_per_shoot","kind":"on_shoot","label":"Multiple picture posts per song per shoot","skippable":false},
      {"key":"marketing","kind":"included","label":"Marketing/advertising setup + help","skippable":false}
   ]}'::jsonb,
   0,
   'Our top solo program. A full album program with custom video count, multiple cover variations, and marketing built in. Inquire for pricing.',
   103),

  ('package-sweet-spot-band', 'Sweet Spot — Band',
   'The Sweet Spot — band edition. Live multicam session, two songs in pro mix, shorts, featured on Sweet Dreams YouTube.',
   'package', 'band', 250000,
   NULL,
   0,
   'Live-band video session, multicam, 2 songs mixed, 3–6 shorts, featured on Sweet Dreams YouTube.',
   104),

  ('package-band-by-request', 'Band Single / EP / Album — By Request',
   'We build custom Single, EP, or Album packages for bands. Tell us about your project.',
   'package', 'band-by-request', NULL,
   NULL,
   0,
   'Custom package built for your band. Tell us your scope.',
   105);
