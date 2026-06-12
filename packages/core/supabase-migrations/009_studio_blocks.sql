-- Admin studio block-off times
CREATE TABLE IF NOT EXISTS studio_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  created_by text,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE studio_blocks ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (admin operations go through service client)
CREATE POLICY "Service role full access on studio_blocks" ON studio_blocks
  FOR ALL USING (true) WITH CHECK (true);
