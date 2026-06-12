# Admin Command Center — Design Spec

**Date:** 2026-05-21
**Status:** Approved design — ready for implementation planning

## 1. Goal

Rework the admin overview (`components/admin/AdminOverview.tsx`) from a passive
scoreboard into an action-oriented **command center**. The page opens with a
"Needs Your Attention" section that surfaces every item requiring an admin
decision, each row deep-linking to the admin tab that resolves it.

The change is purely additive, low-risk, and **read-only + navigation** — it
never mutates data.

## 2. Background / Problem

Today `AdminOverview.tsx` is a scoreboard: KPI cards (today/week/month), a
"Quick Status" row (3 stats), and "Recent Bookings" / "Recent Beat Sales"
lists. It reports *state* but never tells the owner what to *do*. The "Quick
Status" row is a primitive 3-stat precursor to a proper attention surface.

## 3. Scope

**In scope (this spec):** the *admin* command center.

**Out of scope — tracked as future efforts (see §12):**

- **Engineer command center** — same pattern, scoped to one engineer's items.
  Its own spec → plan → build cycle. Requires first exploring the
  engineer-facing portal.
- **Producer command center** — same pattern, scoped to one producer. Its own
  cycle. Requires first exploring the producer-facing portal.
- **Package/membership revenue in the KPI cards** — the existing overview route
  does not count package sales as revenue, so the KPIs slightly undercount.
  This is a *scoreboard* fix that edits existing revenue math and belongs with
  the separate "Financial visibility" upgrade — deliberately excluded here to
  keep this spec a clean, single-purpose, additive change.

**White-label note:** the admin build establishes a **reusable, role-aware
pattern**. The presentational components are role-agnostic; only the data route
and category set are role-specific. The engineer and producer command centers
reuse the presentational layer with their own scoped routes.

## 4. Layout

New top-to-bottom order of `AdminOverview`:

```
┌─ NEEDS YOUR ATTENTION ───────────────── 7 items ─┐
│   SCHEDULING (3)                                  │
│     • individual row  → deep-links to its tab     │
│   MONEY TO CHASE (2)                              │
│     • individual row  → ...                       │
│   SALES & UPSELLS (2)   ...                       │
│   PEOPLE & CONTENT      ✓ all clear               │
└───────────────────────────────────────────────────┘

   [ TODAY ]   [ THIS WEEK ]   [ THIS MONTH ]   ← KPI cards (unchanged)
   RECENT BOOKINGS             RECENT BEAT SALES  ← unchanged
```

- The "Needs Your Attention" block is the **first** element on the page, above
  the KPI cards. It carries a master count of total attention items.
- **Four stacked, full-width groups** in fixed order: Scheduling → Money to
  Chase → Sales & Upsells → People & Content. Each group header shows its own
  item count.
- Within a group, items are organized by **category** (e.g. Scheduling contains
  "Bookings awaiting approval", "No engineer assigned", "Reschedule requests").
  Each non-empty category renders as a labeled sub-list of individual item rows.
- **Empty categories** are omitted. A group whose categories are *all* empty
  collapses to a single slim "✓ all clear" line. If *every* group is empty, the
  whole block shows one "Nothing needs your attention right now" state.
- The existing **"Quick Status" row is removed** — its three stats (pending
  bookings, upcoming-7-day count, outstanding remainders) all become proper
  attention items, so retaining it would duplicate.
- **KPI cards and the two Recent lists are unchanged**, positioned below the
  attention block.

## 5. Attention items

Every row is an individual item (not an aggregate count). The whole row is a
link to the resolving tab. Each row generically shows a primary label (the
person/thing), a secondary detail (date and/or amount and/or reason), and a
category indicator.

Detection rules below come from the data-source audit. Exact status string
values are to be confirmed against `supabase-migrations/` during implementation
planning.

### 5.1 Scheduling

| Category | Detection rule | Row shows | Deep-link |
|---|---|---|---|
| Bookings awaiting approval | `bookings` where `status IN ('pending','pending_approval')` | client name · requested date/time · room | Bookings tab |
| Upcoming sessions with no engineer | `bookings` where `engineer_name IS NULL` AND `start_time >= now()` AND `status = 'confirmed'`; sorted soonest-first; visually flagged as highest priority | client · date/time · room | Bookings tab |
| Reschedule requests | `bookings` where `reschedule_requested = true` AND `status NOT IN ('cancelled','completed')` | client · current date/time · `reschedule_reason` | Bookings tab |

`engineer_name` is the *assigned* engineer (nullable). `requested_engineer` is
the customer's preference — a distinct column, not used for this detection.

### 5.2 Money to Chase

| Category | Detection rule | Row shows | Deep-link |
|---|---|---|---|
| Unpaid balances on past sessions | `bookings` where `remainder_amount > 0` AND `start_time < now()` AND `status IN ('confirmed','completed')` | client · session date · amount owed | Bookings tab |
| Past-due memberships | `package_entitlements` where `payment_status IN ('past_due','collections')` | client · membership name · `last_payment_failed_at` | Packages tab |
| Cash collected, not deposited | `cash_ledger` where `status = 'collected'` (lifecycle: `owed → collected → deposited`) | amount · source (engineer/session) · date collected | Accounting tab |

**Refinement — unpaid balances:** the rule is intentionally narrower than "any
booking with money owed." A *future* confirmed session normally has a balance
that simply isn't due yet — surfacing it would be noise. Only sessions that
have **already happened** with money still outstanding appear here.

### 5.3 Sales & Upsells

| Category | Detection rule | Row shows | Deep-link |
|---|---|---|---|
| Package add-on requests | `package_addon_requests` where `status = 'pending'` | client · requested add-on · date | Packages tab |
| Package credits expiring soon | `package_entitlements` where `status = 'active'` AND `ends_at` within 30 days, joined to `package_entitlement_balances` with unredeemed credit (`quantity_redeemed < quantity_granted`) | client · package · expiry date · credits left | Packages tab |

### 5.4 People & Content

| Category | Detection rule | Row shows | Deep-link |
|---|---|---|---|
| Producer applications to review | `producer_applications` where `status = 'pending'` | applicant name · date applied | Producers tab |
| Beats pending review | `beats` where `status = 'pending_review'` | beat title · producer · submitted date | Beats tab |

### 5.5 Per-category cap

Each category renders up to **5 rows**. If more exist, a "show all N →" control
expands the remainder inline. This keeps a busy week (e.g. many unpaid
balances) from blowing up the page while still honoring "show every item
individually."

## 6. Data & API

### 6.1 New route: `app/api/admin/attention/route.ts`

- A **new** endpoint. The existing `app/api/admin/overview/route.ts` is **not
  modified**.
- **SELECT-only.** No inserts, updates, or deletes.
- Admin-gated using the same auth pattern as the other `app/api/admin/*`
  routes.
- Runs all category queries with **`Promise.allSettled`** so a single failed
  query degrades that one category to empty rather than failing the whole
  response.
- **Time-based filters** (`start_time >= now()`, `start_time < now()`) must
  reuse the existing overview route's Fort Wayne-aware boundary logic
  (`getFortWayneBoundaries()`), not raw UTC `now()`. The platform stores
  wall-clock time labeled as UTC, so a raw `now()` comparison would be off by
  the timezone offset. This route must not invent new time logic — it reuses
  the proven helper.

### 6.2 Response shape

```jsonc
{
  "totalCount": 7,
  "groups": [
    {
      "key": "scheduling",
      "label": "Scheduling",
      "count": 3,
      "categories": [
        {
          "key": "pending_bookings",
          "label": "Bookings awaiting approval",
          "total": 8,
          "tab": "bookings",
          "items": [
            {
              "id": "...",
              "primary": "Jane Doe",
              "secondary": "Sat May 24, 2:00 PM · Room A",
              "flagged": false
            }
          ]
        }
      ]
    }
  ]
}
```

`items` is capped server-side at a generous maximum (e.g. 50 per category),
with `total` carrying the true count. The client renders 5 and expands the rest
on demand. Truly large lists are best handled in the destination tab.

## 7. Components

- **New** `components/admin/AttentionCenter.tsx` — fetches
  `/api/admin/attention`, renders the groups, owns loading / error / empty
  states.
- **New** `AttentionGroup` and `AttentionRow` — role-agnostic presentational
  components (a labeled group; a single clickable item row). These are the
  reusable pieces for the future engineer/producer command centers. File
  organization (separate files vs. colocated) is an implementation-plan
  decision.
- **Modified** `components/admin/AdminOverview.tsx` — render `<AttentionCenter />`
  at the top; delete the "Quick Status" JSX block. No other change.

## 8. Behavior

- **Deep-linking:** clicking a row switches the admin dashboard to the relevant
  tab. The exact mechanism (URL query param vs. lifted tab state) is determined
  in the implementation plan by reading `components/admin/AdminDashboard.tsx`
  and using whatever the dashboard already uses. Pre-filtering the destination
  tab (e.g. Bookings already filtered to pending) is a nice-to-have; the plan
  checks each destination tab and applies it where cheap — otherwise the row
  simply lands on the correct tab.
- **Refresh:** the attention data loads when the Overview tab opens. If
  `AdminDashboard` keeps tabs mounted in the background (so returning to
  Overview does not re-fetch), a small manual "refresh" button is added; if
  returning re-mounts and re-fetches, no button is needed. The plan confirms
  which behavior the tab system has.
- **Loading:** the block shows a skeleton placeholder while fetching.
- **Resilience:** one failed category query → that category shows empty; all
  others render normally. The page always renders.

## 9. Safety / Non-negotiables

- The command center **only reads data and navigates between tabs.** It never
  approves a booking, charges a card, or changes session state. There is no
  code path from the command center into any mutation.
- All actual changes continue to happen exclusively in the existing, unmodified
  tab components.
- The existing `/api/admin/overview` route and the entire booking / session /
  payment flow are **not modified.**
- The new route is admin-gated identically to existing admin routes.
- Net result: this change is structurally incapable of breaking a live session —
  no line of code connects it to one.

## 10. Tunable defaults

| Knob | Default | Notes |
|---|---|---|
| Credits "expiring soon" window | 30 days | tunable |
| Unassigned-sessions horizon | all upcoming, soonest-first | no fixed window |
| Per-category row cap | 5 | "show all" expands inline |
| Empty-group display | collapse to "✓ all clear" line | alternative considered: hide entirely |

## 11. Verification

Before the work is considered done:

- `npx tsc --noEmit` passes with no new errors.
- `GET /api/admin/attention` returns valid JSON; spot-check counts against
  known data.
- Manual smoke test of the Overview page: attention block renders;
  group/category counts are correct; clicking a row lands on the correct tab;
  KPI cards and Recent lists still render unchanged; Quick Status row is gone.
- Diff review confirms no mutation / booking / session code was touched.

The implementation plan will spell out concrete step-level verification.

## 12. Future efforts (logged, not in this spec)

1. **Engineer command center** — reuse `AttentionGroup`/`AttentionRow`; new
   engineer-scoped attention route; categories scoped to a single engineer's
   sessions, payouts, and owed cash. Explore the engineer portal first.
2. **Producer command center** — reuse the presentational layer; new
   producer-scoped route; categories scoped to that producer's beats and
   payouts. Explore the producer portal first.
3. **Package/membership revenue in KPI cards** — fold into the "Financial
   visibility" upgrade.
