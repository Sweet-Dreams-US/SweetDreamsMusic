-- 096_meta_leads.sql — Meta Lead Ads captured into the platform (Marketing tab).
--
-- Leads submitted through Meta lead-ad forms are pulled by a sync job
-- (lib/meta-leads.ts via /api/cron/sync-meta-leads + a manual Sync button) and
-- stored here so the studio owns its leads (Meta only retains them 90 days).
-- leadgen_id is Meta's id for the submission — the upsert key that makes the
-- sync idempotent.
--
-- RLS: enabled with NO policies — this is admin-only data, read/written
-- exclusively through service-role in admin-gated routes (the same posture as
-- other financial/ops tables).

create table if not exists meta_leads (
  id uuid primary key default gen_random_uuid(),
  leadgen_id text not null unique,
  form_id text,
  form_name text,
  campaign_id text,
  campaign_name text,
  ad_id text,
  ad_name text,
  page_id text,
  -- Raw Meta field_data array (question/answer pairs) — kept verbatim so no
  -- custom form question is ever lost, even if extraction below misses it.
  field_data jsonb not null default '[]'::jsonb,
  -- Extracted common fields for list/display/search.
  full_name text,
  email text,
  phone text,
  created_time timestamptz,          -- when the person submitted (Meta)
  status text not null default 'new' check (status in ('new','contacted','converted','ignored')),
  notes text,
  synced_at timestamptz not null default now()
);

create index if not exists idx_meta_leads_created on meta_leads (created_time desc);
create index if not exists idx_meta_leads_status on meta_leads (status);

alter table meta_leads enable row level security;
