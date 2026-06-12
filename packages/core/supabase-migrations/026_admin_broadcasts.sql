-- Admin broadcast/notification email history
CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  template_key TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  recipient_emails TEXT[] NOT NULL DEFAULT '{}',
  sent_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created ON admin_broadcasts (created_at DESC);
