-- Session prep table — artists prepare for their sessions
CREATE TABLE IF NOT EXISTS session_prep (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),

  -- Session type
  session_type TEXT NOT NULL DEFAULT 'recording', -- recording, mixing, mastering, production, other
  session_goals TEXT, -- what they want to accomplish

  -- Beat/instrumental prep
  has_beat BOOLEAN DEFAULT false,
  beat_source TEXT, -- 'upload', 'link', 'need_beat', 'producing'
  beat_file_url TEXT, -- uploaded beat file URL
  beat_file_name TEXT,
  beat_link TEXT, -- YouTube/SoundCloud link etc
  beat_notes TEXT, -- description of the beat or what they're looking for

  -- Reference tracks
  reference_tracks JSONB DEFAULT '[]'::jsonb, -- [{title, artist, link, notes}]

  -- Lyrics/content
  has_lyrics BOOLEAN DEFAULT false,
  lyrics_status TEXT, -- 'written', 'partial', 'freestyle', 'none'
  lyrics_text TEXT, -- actual lyrics if they want to paste them

  -- Additional info
  vocal_style TEXT, -- genre/style description
  special_requests TEXT, -- any special equipment, effects, etc
  num_songs INTEGER DEFAULT 1, -- how many songs they plan to work on
  previous_session BOOLEAN DEFAULT false, -- have they been here before

  -- Status
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE session_prep ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own prep" ON session_prep FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own prep" ON session_prep FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own prep" ON session_prep FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Engineers can view all prep" ON session_prep FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('engineer', 'admin'))
);

CREATE INDEX idx_session_prep_booking ON session_prep(booking_id);
CREATE INDEX idx_session_prep_user ON session_prep(user_id);
