-- 048_media_booking_packages.sql
--
-- Round 8c: locked-scope package + line items per media booking.
-- Live edit (no versioning); per-line-item approval; package as a whole
-- flips to 'approved' once every line item is approved.
--
-- Auto-inject rule (planning_call required for music_video kind OR
-- shorts qty > 2) is enforced in the API layer — DB just stores whatever
-- shape the API hands it.
--
-- Idempotent. trg_set_updated_at() comes from migration 039.

CREATE TABLE IF NOT EXISTS media_booking_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL UNIQUE REFERENCES media_bookings(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'approved')),
  total_cents     INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  proposed_at     TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_booking_packages_status_idx
  ON media_booking_packages (status);

DROP TRIGGER IF EXISTS media_booking_packages_updated_at ON media_booking_packages;
CREATE TRIGGER media_booking_packages_updated_at BEFORE UPDATE ON media_booking_packages
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS media_booking_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID NOT NULL REFERENCES media_booking_packages(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  source_slot_key TEXT,
  label           TEXT NOT NULL,
  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_cents      INTEGER NOT NULL DEFAULT 0 CHECK (unit_cents >= 0),
  total_cents     INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  notes           TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending'
                  CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_at     TIMESTAMPTZ,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_booking_line_items_package_idx
  ON media_booking_line_items (package_id, sort_order);
CREATE INDEX IF NOT EXISTS media_booking_line_items_kind_idx
  ON media_booking_line_items (kind);

DROP TRIGGER IF EXISTS media_booking_line_items_updated_at ON media_booking_line_items;
CREATE TRIGGER media_booking_line_items_updated_at BEFORE UPDATE ON media_booking_line_items
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMENT ON TABLE media_booking_packages IS
  'Locked-scope object after admin scoping call. One per booking, live-edited; status drives buyer review surface.';
COMMENT ON TABLE media_booking_line_items IS
  'Each deliverable in a package — cover art, shorts, music video, planning call. Buyer approves per-item; once all approved, package flips to approved.';

-- RLS — same access pattern as messages.
ALTER TABLE media_booking_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_booking_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pkg_buyer_read ON media_booking_packages;
CREATE POLICY pkg_buyer_read ON media_booking_packages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM media_bookings mb WHERE mb.id = media_booking_packages.booking_id AND mb.user_id = auth.uid()));

DROP POLICY IF EXISTS pkg_band_read ON media_booking_packages;
CREATE POLICY pkg_band_read ON media_booking_packages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM media_bookings mb JOIN band_members bm ON bm.band_id = mb.band_id WHERE mb.id = media_booking_packages.booking_id AND bm.user_id = auth.uid()));

DROP POLICY IF EXISTS pkg_admin_read ON media_booking_packages;
CREATE POLICY pkg_admin_read ON media_booking_packages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS pkg_engineer_read ON media_booking_packages;
CREATE POLICY pkg_engineer_read ON media_booking_packages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM media_session_bookings s WHERE s.parent_booking_id = media_booking_packages.booking_id AND s.engineer_id = auth.uid()));

DROP POLICY IF EXISTS line_items_buyer_read ON media_booking_line_items;
CREATE POLICY line_items_buyer_read ON media_booking_line_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM media_booking_packages p JOIN media_bookings mb ON mb.id = p.booking_id WHERE p.id = media_booking_line_items.package_id AND mb.user_id = auth.uid()));

DROP POLICY IF EXISTS line_items_band_read ON media_booking_line_items;
CREATE POLICY line_items_band_read ON media_booking_line_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM media_booking_packages p JOIN media_bookings mb ON mb.id = p.booking_id JOIN band_members bm ON bm.band_id = mb.band_id WHERE p.id = media_booking_line_items.package_id AND bm.user_id = auth.uid()));

DROP POLICY IF EXISTS line_items_admin_read ON media_booking_line_items;
CREATE POLICY line_items_admin_read ON media_booking_line_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS line_items_engineer_read ON media_booking_line_items;
CREATE POLICY line_items_engineer_read ON media_booking_line_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM media_booking_packages pkg JOIN media_session_bookings s ON s.parent_booking_id = pkg.booking_id WHERE pkg.id = media_booking_line_items.package_id AND s.engineer_id = auth.uid()));
