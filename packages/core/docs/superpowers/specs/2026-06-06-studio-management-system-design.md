# Studio Management System — Design & Roadmap

**Date:** 2026-06-06
**Status:** Design for review (revenue-core refactor — do NOT build until Cole signs off)
**Owner:** Cole

---

## 0. TL;DR — what we're building

Make **everything about a studio admin-managed and DB-driven** so Cole (and, later, each
studio) can run the business without developer code changes:

- **Add / remove / rename studios** (today `studio_a` / `studio_b` are hardcoded).
- **Set per-studio pricing** (hourly rate, single-hour rate, the Sweet-4, band tiers, surcharges,
  deposit %, guest fees).
- **Control per-studio hours** (open/close, weekday rules, same-day buffer, min/max duration).
- **Assign engineers** to studios (today the `ENGINEERS` roster is hardcoded).
- **Edit the public front pages** (hero copy, descriptions, photos, displayed pricing/hours,
  engineer bios, portfolio, contact) — a lightweight **CMS**, no code edits.

Every change flows **both ways**: the booking ENGINE (pricing, availability, routing) *and* the
public MARKETING pages read from the same config.

**Scope now:** single location, multiple bookable studios/rooms — architected so the
white-label / multi-location platform drops in later (each `studios` row already stands alone).

---

## 1. Why this is high-risk (and how we de-risk it)

`calculateSessionTotal` / `calculateBandSessionTotal` and the `ROOMS`/`PRICING`/`ENGINEERS`
constants are read in **100+ places** — booking create, the Stripe charge, availability,
engineer routing, emails, accounting/payroll, and every public page. The pricing math must
return **identical cents** after the refactor or revenue/PNL breaks.

**De-risk strategy:**
1. **Golden pricing tests first** — snapshot today's `calculateSessionTotal` output across a
   matrix (rooms × hours × start-hours × same-day × guests × band tiers). The DB-driven version
   must reproduce every value exactly before anything ships.
2. **Constants-fallback** — the config loader falls back to the current constants if a studio
   row is missing, so a half-migrated state can't break booking.
3. **Backfill = current values** — seed `studios`/pricing/engineers from the existing constants,
   so day-one behavior is byte-identical.
4. **Phased, each phase independently shippable + reversible.** Pricing engine flips last.
5. **`room` stays a slug** (`studio_a`) referencing `studios.slug` — existing bookings + the
   100+ `ROOM_LABELS[room]` lookups keep working unchanged.

---

## 2. Target schema

```
studios                      -- one row per bookable studio/room (replaces the ROOMS enum)
  id uuid pk
  slug text unique           -- 'studio_a' (stable; bookings.room references this)
  display_name text          -- 'Studio A'
  description text, hero_image_url text, gallery jsonb
  hourly_rate_cents int      -- 2+ hour rate
  single_hour_rate_cents int -- 1-hour rate
  deposit_percent int        -- default 50
  min_hours numeric, max_hours numeric
  free_guests int, guest_fee_cents int, max_guests int
  weekday_start_hour numeric null  -- Studio-A-style restriction (NULL = always open)
  open_hour numeric, close_hour numeric  -- bookable window (default 0–24)
  same_day_buffer_hours int  -- default 3
  band_enabled bool          -- band bookings allowed (Studio A only today)
  sort_order int, active bool, created_at, updated_at

studio_pricing_tiers         -- Sweet-4 + band packages, per studio
  id uuid pk, studio_id fk
  kind text                  -- 'sweet_4' | 'band_4h' | 'band_8h' | 'band_24h'
  hours numeric, price_cents int, per_hour_cents int, label text, note text, active bool

studio_surcharges            -- night/same-day windows, per studio (or global default)
  id uuid pk, studio_id fk null   -- null = applies to all studios
  kind text                  -- 'late_night' | 'deep_night' | 'same_day'
  start_hour numeric, end_hour numeric, amount_cents int, active bool

engineers                    -- DB-driven roster (replaces the ENGINEERS constant)
  id uuid pk
  email text unique          -- STABLE identity (payroll keys off this — never changes)
  name text                  -- canonical payroll name; display_name text
  specialties text[], photo_url text, bio text
  active bool, sort_order int
  (studio assignment via studio_engineers pivot)

studio_engineers             -- which engineers work which studios
  studio_id fk, engineer_id fk, primary key (studio_id, engineer_id)

site_content                 -- the CMS: keyed editable content blocks for public pages
  key text pk                -- 'home.hero.title', 'about.body', 'footer.hours', ...
  value jsonb                -- text / rich-text / image url / list — typed per key
  updated_by, updated_at
```

**Why a pivot for engineers:** an engineer works N studios; a studio has N engineers. The
hardcoded `studios: Room[]` becomes `studio_engineers`. Email stays the immutable identity so
payroll name-mapping (`normalizeName`/`NAME_MAP`, the Zion-rename lesson) never breaks.

---

## 3. The config layer (the linchpin)

A single server module `lib/studio-config.ts`:
- `getStudios()` → active studios (cached per request) for pickers + public display.
- `getStudioConfig(slug)` → the full pricing/hours/guest config for one studio.
- `priceSession(config, {hours, startHour, sameDay, guests})` → the EXACT shape
  `calculateSessionTotal` returns today, computed from config (not constants).
- `getSurchargeWindows(config)` / `isOpenAt(config, when)` / `sameDayBuffer(config)`.

`calculateSessionTotal`/`calculateBandSessionTotal` are reimplemented to take a config object;
a thin wrapper keeps the old signature working off the seeded defaults during migration. The
booking create, availability, and BookingFlow all switch to the config loader.

Public pages call `getStudios()` + `site_content` in their server components (ISR with
`revalidateTag('studios')` / `revalidateTag('site_content')` on admin save → instant updates,
cached reads).

---

## 4. Admin surfaces (the "front management system")

- **Admin → Studios** (`components/admin/StudioManager.tsx`): list studios; add / edit / archive;
  per-studio form for rates, single-hour rate, Sweet-4, band tiers, deposit %, hours/weekday
  rule/buffer/min-max, guest fees; assign engineers (multi-select from the roster); hero/gallery
  images + description. Archive (not hard-delete) preserves historical bookings.
- **Admin → Engineers** (`components/admin/EngineerManager.tsx`): CRUD the roster (name, email,
  specialties, photo, bio, active) + studio assignments. Migrates engineers off the constant the
  same way media managers are already DB-driven.
- **Admin → Site Content** (`components/admin/SiteContentEditor.tsx`): edit the public-page blocks
  (hero copy, about, services, pricing intro, band/Sweet-Spot copy, footer hours/contact, social
  links, portfolio video IDs) — grouped by page, with image upload. This is the CMS.

All gated to admin; carry `studio_id` where relevant for the future per-studio-admin model.

---

## 5. Phased plan (each phase ships + is reversible; booking never breaks)

1. **Golden tests + schema + backfill (invisible).** Snapshot current pricing across the full
   matrix. Migration creates the tables; backfill seeds studios/pricing/surcharges/engineers/
   site_content from today's constants. Nothing reads the DB yet.
2. **Config layer + pricing parity.** Build `lib/studio-config.ts` + config-driven pricing;
   prove it reproduces the golden snapshot exactly. Still not wired into routes.
3. **Engine cutover (read from DB, constants fallback).** Booking create, availability,
   BookingFlow, credit-book, engineer routing read the config loader. Re-run golden + the booking
   E2E. This is the revenue-critical flip — heavily tested.
4. **Admin Studios + Engineers managers.** CRUD studios/pricing/hours + roster + assignments.
   Add/remove a studio end-to-end; verify booking + payroll still tie out.
5. **Public pages → DB.** Homepage, /pricing, /engineers, /about, /bands, /book, footer read
   studios + site_content. Admin Site Content editor. ISR revalidation on save.
6. **Cleanup.** Remove the duplicated `ROOM_LABELS`/`BAND_PRICING` copies; the constants become
   seed-only defaults.

---

## 6. Risks / must-not-break
- **Pricing parity** (golden tests gate every phase). Band = Studio-A-only constraint → `band_enabled`.
- **Payroll identity**: engineers keyed by **email**; `normalizeName` keeps working as roster
  moves to DB (carry the NAME_MAP aliases as `engineers.name` history).
- **`room` slug stability**: never renumber existing bookings; archive studios, don't delete.
- **Availability**: already mostly generic (studio_blocks/engineer_blocks are DB-driven) — only
  the hours/buffer source changes.
- **Stripe**: the charge reads the computed total; config-driven pricing must flow through unchanged.

---

## 7. Decisions for Cole
1. **"Studio" = a bookable room/space** (studio_a, studio_b are two studios at one location),
   admin add/remove — architected for multi-location later. Correct?
2. **CMS depth**: full block-level editing of all public copy + photos (bigger), or start with
   the high-value bits (studio descriptions, pricing display, hours, engineer bios/photos) and
   expand? Recommend the high-value bits first.
3. **Engineers off the hardcoded roster now** (DB table + payroll keyed by email), or keep the
   constant for this pass and only DB-drive studios/pricing/content first? (Roster migration is
   the most payroll-sensitive piece.)
4. **Branch**: this is large + independent of rewards — recommend its own branch off `main`
   (rewards merges separately), or stack on `rewards-system`?
5. **Build order**: engine config first (pricing/hours/studios) → then the public CMS? Or CMS
   first (lower risk, visible) → then the engine?
