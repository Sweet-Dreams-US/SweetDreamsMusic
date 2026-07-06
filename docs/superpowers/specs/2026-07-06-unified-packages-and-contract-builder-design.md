# Unified Packages + Contract Builder — Design

> Status: approved design (2026-07-06). Next: implementation plan (writing-plans).
> Scope: one coherent redesign covering three asks — (1) combine packages into the
> media contract builder, (2) a proper home for packages spanning the music studio
> + media, (3) fix the contract builder's "two prices" problem.

## Problem

Three overlapping systems exist today, and the contract builder shows two competing prices.

1. **Catalog packages** — `media_offerings` with `kind='package'` (Single Drop, EP, Album,
   Sweet Spot). Already bundle studio hours (`studio_hours_included` → `studio_credits`
   on purchase) + media (`components.slots`). Self-serve purchase on `/media`.
2. **Template packages** — `package_templates` + `package_template_lines`
   (`kind` = `studio_hours | media_offering | beat_credit | custom`) → `package_quotes`
   → `package_entitlements` (redeemable wallet). Admin-built, quoted per artist.
3. **Contract builder** — `components/media-team/ContractBuilder.tsx`
   (`/media-team/contracts/new`, API `app/api/admin/media/bookings/contract/route.ts`)
   assembles a bespoke `media_booking` from **line items** (`media_booking_line_items`:
   `kind, source_slot_key, label, qty, unit_cents, total_cents`) → `media_booking_packages`
   total → `media_payment_installments`.

**The double-price bug:** in the contract builder the Section‑1 offering dropdown displays
each offering's `price_cents` (e.g. "Short — Premium · $200"), but that price is **never used**.
The real price comes only from the Section‑3 line items, where the admin types each unit price
(offering "slot" quick-adds even open with a blank price). So a catalog number ($200) sits on
screen while the admin types a different number ($150) — two prices, only one of which counts.

## Decisions (locked with Cole 2026-07-06)

- **Design all three together** as one spec.
- **A package is "define once, use either way"** — a single package definition can be listed
  for self-serve purchase at a set list price AND dropped into a contract where the admin sets
  a per-deal price.
- **(a) Migrate** existing catalog packages into the one unified system (do not run two
  package systems indefinitely).
- **(b) A `studio_hours` line auto-grants redeemable studio time** (studio_credits) when paid,
  so "includes the music studio" is functional, not cosmetic.

## The core idea: one Scope Line Item

Everything — contracts AND packages — is a list of the same atom:

```
ScopeLineItem {
  type: 'studio_hours' | 'media' | 'beat' | 'custom'
  label: string                 // "what it is" (human text)
  catalog_ref?: {               // optional link for scope/labels ONLY — never price
    media_offering_id?: string  // for type 'media'
    beat_id?: string            // for type 'beat'
  }
  qty: number
  unit_price_cents: number       // the ONE price — always set by the admin/definer
  is_free_addon?: boolean        // forces price 0 (bundled)
  notes?: string
}
```

This shape already matches both `media_booking_line_items` (contract) and
`package_template_lines` (package). We align them so a package's lines drop straight into a
contract and vice-versa. **Price is a property of the line item, never inherited from a catalog
row as a competing number.**

## Piece 1 — Contract builder: pick what it is, set the price (one number)

`ContractBuilder.tsx` changes:

- **Remove price from selection.** The Section‑1 offering dropdown no longer shows or applies a
  price. (Keep `media_bookings.offering_id` as an optional reference tag only.)
- **Each deliverable row becomes:** `[Type ▾] [What it is — pick a catalog service OR type a label] [Qty] [Price $__]`.
  The price input is the only number on the line. Picking a catalog service fills the
  label/type (scope), leaving price for the admin to set. No second price is rendered anywhere.
- Total = Σ line `total_cents` (unchanged); installments validate against that total (unchanged).

Result: exactly one price per line, owned by the admin — the "two prices" disappear.

## Piece 2 — Start from a package

- A **"Start from a package ▾"** control near the top of the deliverables section.
- Selecting a package pre-loads its line items into the builder as editable rows
  (studio hours + media + custom), each price pre-filled from the package's list price but fully
  overridable. Admin can then add/remove/edit rows and set per-deal prices.
- A contract can be built from scratch, from a package, or a package + extra custom lines.

## Piece 3 — Packages home (define once, use either way)

Upgrade the existing admin **Packages** tab (`package_templates`) into one unified builder:

- A **package** = name + audience (`solo | band | both`) + a set of Scope Line Items
  (studio hours + media + beats + custom), each with a **list price**.
- **Sellable toggle + list price:** when on, the package appears on `/media` + the Artist Hub
  media tab for self-serve purchase. On purchase it grants `studio_credits` for `studio_hours`
  lines and `media_credits` for `media` lines, reusing the existing grant machinery
  (`lib/media-credits.ts` + the webhook `media_purchase`/`package_quote` branches).
- **Contract use:** the same package drops into the contract builder at a per-deal price the
  admin sets (list price shown only as faint reference).
- **Deals integration:** the `media_deals` system (red promo banners + price override) can
  target a sellable package the same way it targets an offering.

## Data model — consolidate to one package system

- **`package_templates` + `package_template_lines` become THE package definition** (they already
  carry the four line kinds). Extend `package_template_lines` to the ScopeLineItem shape where
  needed (ensure `label`, `qty`, `unit_price_cents`/`list price`, `catalog_ref`).
- Individual services stay as `media_offerings` with `kind='standalone'`.
- **Migration:** convert each existing `media_offerings` `kind='package'` row (Single Drop, EP,
  Album, Sweet Spot) into a `package_template` (+ lines derived from its `components.slots` and
  `studio_hours_included`). Add a `sellable` flag + list price so they keep showing on `/media`.
  Keep offering ids referenced by any historical `media_bookings` intact (do not delete offering
  rows that historical bookings point at; mark them retired/hidden instead).
- Contract line items (`media_booking_line_items`) and package lines share the aligned shape so
  "start from a package" is a direct copy.

## Fulfillment

- **`studio_hours` line** → grants redeemable studio time via `studio_credits`
  (existing `/api/packages/entitlements/[id]/redeem-session` + `studio_credit_redemptions`).
- **`media` line** → media credits / media booking line as today.
- **Contract path** → line items build the `media_booking` + `media_booking_packages` +
  `media_payment_installments` (as today); `studio_hours` lines additionally grant studio credits
  when the corresponding installment/deposit is paid.
- **Self-serve package purchase** → existing webhook grant path (studio + media credits).

## Rollout order (built together, shipped in safe slices)

1. **Line-item model + migration** — align `media_booking_line_items` ↔ `package_template_lines`
   to the ScopeLineItem shape; migrate catalog packages → templates (+ `sellable`/list price).
2. **Contract builder** — remove selection price; one price per line; "Start from a package."
3. **Packages home** — unified admin builder; sellable surfacing on `/media` + hub; deals hook.
4. **Retire** the old `media_offerings kind='package'` path once nothing reads it.

## Testing / verification

- Migration parity: every existing catalog package renders on `/media` post-migration with the
  same visible contents + list price; existing `media_bookings` still resolve their offering.
- Contract builder: building a contract from scratch, from a package, and mixed all produce a
  correct total = Σ line prices; installments must still sum to the total; only one price input
  per line (assert no catalog price rendered as an input).
- Fulfillment: a paid contract/package with a `studio_hours` line creates redeemable
  `studio_credits`; a `media` line creates the expected `media_credits`.
- Money-critical: the checkout/charge always prices from the line items (server-recomputed),
  never from a stale catalog number — same discipline as the deals chokepoint.

## Risks

- **Migration of live catalog packages** is the riskiest slice (historical bookings reference
  offering ids; self-serve purchase must keep working). Mitigation: additive migration, retire
  (don't delete) old offering rows, parity check before removing the old path.
- **Two write paths during transition** (old catalog package purchase vs new template purchase).
  Mitigation: ship the unified read/definition first, migrate, then flip purchase, then retire.
- **Pricing coherence** — keep one server-side chokepoint that prices from line items so no
  surface can charge a stale number (mirrors the `media_deals` overlay pattern).

## Out of scope (for this spec)

- Unifying the studio `/book` calendar with `media_session_bookings` (separate future project).
- Changing engineer payout / commission math.
- Changing the booking rush-fee / charge-on-accept work (separate branch).
