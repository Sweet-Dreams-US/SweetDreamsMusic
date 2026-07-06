-- 097_media_deals.sql — admin-managed promotional deals on media offerings.
--
-- A deal = one offering + a marketing face (title/tagline) + a special price.
-- While active (and inside its optional date window), the ARTIST-FACING
-- catalog loaders (lib/media-server) override the offering's price with the
-- deal price, so the catalog card, configure form, cart, AND checkout all
-- show/charge the deal price coherently — the offering's real base price is
-- never edited (Cole: "I don't want to change the price; this is a special").
-- The public /media page + hub Media tab render a red promo banner per
-- active deal (replacing the previously hardcoded Music Video Special).
--
-- RLS: public SELECT (deals are public marketing data); writes are
-- service-role only (admin routes) — no insert/update/delete policies.

create table if not exists media_deals (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references media_offerings(id) on delete cascade,
  title text not null,               -- marketing name, e.g. "Music Video Special"
  tagline text,                      -- one-liner under the title
  deal_price_cents integer not null check (deal_price_cents > 0),
  active boolean not null default true,
  starts_at timestamptz,             -- null = immediately
  ends_at timestamptz,               -- null = until deactivated
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_media_deals_offering on media_deals (offering_id);
create index if not exists idx_media_deals_active on media_deals (active);

alter table media_deals enable row level security;
drop policy if exists media_deals_public_read on media_deals;
create policy media_deals_public_read on media_deals for select using (true);
