-- Beat Agreements: tracks producer contract acceptance for beat listings
-- Each beat requires producer sign-off before going live

CREATE TABLE IF NOT EXISTS beat_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id UUID NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
  producer_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  agreement_version TEXT NOT NULL DEFAULT '1.0',
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  producer_name TEXT NOT NULL,
  beat_title TEXT NOT NULL,
  commission_rate NUMERIC(4,2) NOT NULL DEFAULT 0.60,
  platform_rate NUMERIC(4,2) NOT NULL DEFAULT 0.40,
  agreement_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed' CHECK (status IN ('signed', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_beat_agreements_beat_id ON beat_agreements(beat_id);
CREATE INDEX IF NOT EXISTS idx_beat_agreements_producer_profile_id ON beat_agreements(producer_profile_id);

-- RLS
ALTER TABLE beat_agreements ENABLE ROW LEVEL SECURITY;

-- Producers can read their own agreements
CREATE POLICY "Producers can read own agreements"
  ON beat_agreements FOR SELECT
  USING (
    producer_profile_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- Admins (service role) can read all — handled via service client
-- Producers can insert their own agreements
CREATE POLICY "Producers can insert own agreements"
  ON beat_agreements FOR INSERT
  WITH CHECK (
    producer_profile_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
  );
