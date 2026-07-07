# Unified Packages + Contract Builder — Design

> Status: approved design (2026-07-06), **revised same day after a full code map** (see
> "What the code map changed" below). Next: implementation plan (writing-plans).
> Scope: one coherent redesign covering three asks — (1) combine packages into the
> media contract builder, (2) a proper home for packages spanning the music studio
> + media, (3) fix the contract builder's "two prices" problem.

## Problem

Three overlapping systems exist today, and the contract builder shows two competing prices.

1. **Catalog packages** — `media_offerings` with `kind='package'` (Single Drop, EP, Album,
   two Sweet Spot variants, Band-by-request — 6 rows). They carry a rich **slot configurator**
   in `components.slots` (tiers with price deltas, skippable add-ons, flexible/per-song slots).
   Self-serve on `/media` → configurator → `/api/media/checkout` → webhook `media_purchase`
   grants `studio_credits` (from `studio_hours_included`) + `media_credits` (from unit slots).
2. **Template packages** — `package_templates` + `package_template_lines`
   (line `kind` in use: `studio_hours`, `media_offering`; `beat_credit`/`custom` defined) →
   admin quote (`package_quotes`) → on payment `mintEntitlementFromQuote` creates
   `package_entitlements` + per-line `package_entitlement_balances` (the redeemable wallet).
   `studio_hours` balances redeem via `/api/packages/entitlements/[id]/redeem-session`;
   `media_offering` balances via `redeem-media`. 4 live templates today (3 memberships + Cinco Cash).
3. **Contract builder** — `components/media-team/ContractBuilder.tsx`
   (`/media-team/contracts/new`, API `app/api/admin/media/bookings/contract/route.ts`)
   assembles a bespoke `media_booking` from **line items** (`media_booking_line_items`:
   `kind, source_slot_key, label, qty, unit_cents, total_cents`) → `media_booking_packages`
   → `media_payment_installments`. `media_bookings.final_price_cents` = Σ line `total_cents`.

**The double-price bug (confirmed in code):** the Section-1 offering `<select>` renders each
option as `` `${o.title} · ${formatCents(o.price_cents)}` `` (ContractBuilder.tsx ~704–709).
That price is **never stored in state, never sent to the API, never summed** — the contract
total is derived 100% from the manually-priced deliverable line items (ContractBuilder ~229–234;
API `computePackageTotalCents`, route ~366–377). So a catalog number sits on screen next to a
different number the admin types — "two prices, only one of which counts."

## Decisions (locked with Cole 2026-07-06)

- **Design all three together** as one spec.
- **A package is "define once, use either way"** — a single package definition can be listed
  for self-serve purchase at a set list price AND dropped into a contract at a per-deal price.
- **A `studio_hours` line grants redeemable studio time** so "includes the music studio" is
  functional, not cosmetic.

## What the code map changed (2026-07-06, evidence-based revision)

The original spec said "migrate catalog packages into `package_templates` and retire the old
path." The full code map shows that is **lossy and unnecessary**:

- Catalog packages carry a self-serve **slot configurator** (tier deltas, skippable add-ons,
  flexible/per-song slots) that the *flat* `package_template_lines` shape cannot represent.
  Migrating would destroy the working self-serve buy+configure+fulfill experience.
- The two systems already have **complete, distinct fulfillment**. Nothing is broken; there is
  no maintenance win that justifies a destructive migration.
- **"Start from a package" needs no migration** — a read-time normalizer flattens *either*
  system into the builder's existing `DeliverableRow` shape.

**Revised principle: two definition systems, one unified surface.** Keep both package systems.
Make `package_templates` the admin "Packages home," let it optionally be **sellable** on
`/media`/hub (reusing the existing quote→entitlement fulfillment), and let the contract builder
**read from both** systems via a normalizer. No destructive migration; no retiring a working path.

## The core idea: one read-time line-item shape

The contract builder already has the right atom — `DeliverableRow`:

```
DeliverableRow {
  kind: LineItemKind            // one of planning_call | cover_art | shorts | music_video |
                                //  photo_session | filming_external | mixing_session |
                                //  design_meeting | recording_session | other  (lib/media-packages)
  label: string                 // "what it is" (human text)
  qty: string                   // numeric string ≥ 1
  unitDollars: string           // the ONE price — always admin-set (blank until typed)
  source_slot_key: string|null  // provenance when loaded from a package slot; null for custom
  notes: string
  is_free_addon: boolean        // forces unit 0
}
```

We add a **read-time normalizer** that turns *any* package (template or catalog) into a list of
these rows, so "start from a package" is a pure copy into editable state. Price is a property of
the line, admin-set, never inherited as a competing number.

## Piece 1 — Contract builder: pick what it is, set the price (one number)

`ContractBuilder.tsx`:

- **Strip the price from the offering selector.** The Section-1 `<option>` label becomes just
  `{o.title}` (drop the ` · $X` / ` · (inquiry)` suffix, ~707–708). `offering_id` stays required
  (it is NOT NULL on `media_bookings` and tags the project category) but shows no price. Add
  helper text: "Category only — the price comes from the deliverables below."
- Each deliverable row already is `[Kind ▾] [Label] [Qty] [Unit price $]` with exactly one price
  input (~965–1044). Keep it; that IS "select what it is + set the price yourself."
- Total = Σ line `total_cents` (unchanged); installments must still sum to it exactly (unchanged).

Result: exactly one price per line, admin-owned — the "two prices" disappear.

## Piece 2 — Start from a package (reads BOTH systems)

- A **"Start from a package ▾"** control above the deliverables section.
- Options come from a new admin route that returns a normalized list from **both**
  `package_templates` (flatten lines) and catalog `media_offerings kind='package'` (flatten
  `components.slots`), each as `{ source, id, name, audience, lines: NormalizedLine[] }`.
- Selecting a package replaces the deliverables with its normalized rows (editable). Prices are
  pre-filled where the source has a per-line value (template `full_price_cents / quantity`),
  otherwise blank ($0) for the admin to set per deal. Admin can add/remove/re-price any row.
- A contract can be built from scratch, from a package, or a package + extra custom lines.

## Piece 3 — Packages home (define once, use either way)

Make the existing admin **Packages** tab (`package_templates`, `PackageCalculator`) the unified
home; it already supports `studio_hours` + `media_offering` (+ `beat_credit`/`custom`) lines, so
"includes the studio" is already true. Additions:

- **Sellable toggle + list price + public blurb + slug.** Add `is_sellable` and `public_blurb`
  columns to `package_templates` (`slug`, `price_cents`, `audience` already exist). When
  `is_sellable && is_active`, the template appears on `/media` + the Artist Hub media tab.
- **Self-serve purchase reuses the existing quote→entitlement path.** A "Buy" CTA creates a
  `package_quote` for the buyer and starts Stripe checkout via the *existing* package-quote
  checkout machinery; on payment the *existing* `package_quote` webhook branch calls
  `mintEntitlementFromQuote`, producing the redeemable entitlement (studio_hours + media). No new
  fulfillment code — only a thin "buy this sellable template" entry that mints a quote + checkout.
- **Contract use:** the same template drops into the contract builder (Piece 2) at admin-set
  per-deal prices.
- **Deals (optional, later):** `media_deals` currently targets `media_offerings` only
  (`offering_id NOT NULL`). Targeting sellable templates would need `media_deals` to also accept a
  `package_template_id` — out of scope for the first cut; note it as a follow-up.

## Fulfillment (all existing machinery, reused)

- **Contract `recording_session` line (studio hours)** → grant `studio_credits` on the deposit
  payment, sourced from the contract's `media_bookings.id` (the FK `studio_credits.source_booking_id`
  → `media_bookings(id)` already allows this; no schema change). Hours = Σ recording_session qty.
  (This is the "studio_hours line grants redeemable studio time" hook for contracts.)
- **Sellable template purchase** → `package_quote` → webhook `mintEntitlementFromQuote` →
  `package_entitlements` + balances (studio_hours redeemable via `redeem-session`, media via
  `redeem-media`). Unchanged.
- **Catalog package self-serve** → webhook `media_purchase` grants `media_credits` +
  `studio_credits`. Unchanged.

## Data model changes (additive only)

- `package_templates`: **ADD** `is_sellable boolean not null default false`, **ADD**
  `public_blurb text`. (Migration 098.) Nothing dropped; no data moved.
- No changes to `media_offerings`, `media_bookings`, line-item, credit, or entitlement tables.
- No destructive migration of catalog packages. No table retired.

## Rollout order (safe slices; A+B ship first, no payment risk)

1. **Slice A — Contract builder double-price fix** (Piece 1). Pure UI; ship + verify first.
2. **Slice B — Start from a package** (Piece 2): normalizer helper + read route + builder control.
   Reads only; no writes to package systems, no payment path.
3. **Slice C — Packages home sellable** (Piece 3): migration 098 + calculator toggles + `/media`
   & hub surfacing + self-serve buy (quote+checkout reuse). This is the payment-touching slice;
   ship after A+B are verified in production.
4. **Slice D — Contract studio-credit grant** (Fulfillment): grant `studio_credits` from
   `recording_session` lines on the contract's deposit payment. Money-path; golden-verify.

## Testing / verification

- **Normalizer (pure):** a `scripts/`-style tsx proof that both a real `package_template` and a
  real catalog package (e.g. `package-single-drop`) normalize to the expected `DeliverableRow[]`
  (correct kinds, labels, qty; prices pre-filled from template line `full_price_cents/quantity`,
  blank for catalog slots). Repo convention = tsx proof script, not a unit framework.
- **Contract builder:** build from scratch, from a template, from a catalog package, and mixed —
  each produces total = Σ line prices; installments must still sum exactly; assert the offering
  dropdown renders **no** price. `tsc` + `npm run build`.
- **Sellable purchase:** a test buy of a sellable template mints a `package_entitlement` with the
  expected balances (studio_hours + media) — verify against live/test data.
- **Contract studio credit:** a paid contract with a `recording_session` line creates
  `studio_credits` with the right hours, sourced from the booking. Must not change any existing
  payout/credit for non-recording contracts (golden check).
- **Money-critical discipline:** server always recomputes price from line items / configurator —
  never trusts a stale catalog number (mirrors the `media_deals` chokepoint).

## Risks

- **Slice C payment path** (self-serve template buy) is the riskiest. Mitigation: reuse the
  existing, proven quote→checkout→`mintEntitlementFromQuote` path end-to-end; add only a thin
  "buy" entry; test with a real (small/test) purchase before announcing.
- **Slice D money path** (studio-credit grant from contracts). Mitigation: grant only for
  `recording_session` lines, only on the deposit-paid transition, idempotent by booking id;
  golden-verify no change to existing contracts.
- **Taxonomy mapping** (template/catalog kinds → contract `LineItemKind`). Mitigation: an explicit
  slug/slot→`LineItemKind` map in the normalizer with an `other` fallback; covered by the proof.

## Out of scope (for this spec)

- Destroying/migrating the catalog-package configurator (explicitly rejected above).
- Unifying the studio `/book` calendar with `media_session_bookings` (separate future project).
- Changing engineer payout / commission math.
- `media_deals` targeting templates (noted as a follow-up).
- The booking rush-fee / charge-on-accept work (separate branch).
