# Rewards Banking, Redemption & Accounting — Design

**Date:** 2026-06-06
**Status:** Design for review (do NOT build into live booking/accounting until Cole signs off)
**Owner:** Cole
**Companion to:** `2026-06-05-rewards-achievements-roadmap.md`

---

## 0. TL;DR — the one principle that makes it all work

> **An engineer/team member is always paid for the WORK they do — on the full value of the
> session — no matter what the customer actually paid.** Rewards reduce the studio's
> *revenue*, never the staff member's pay. The gap is a tracked rewards/marketing cost.

Everything below (the "bank," redemption at booking, the correct charge, paying the employee,
the accounting) falls out of that one rule.

**Why this matters right now:** today the payroll math pays an engineer `total_amount × 60%`.
A credit/comped session has `total_amount = $0`, so **the engineer earns $0 for real work** —
a bug that already affects the existing prepaid-credits feature (documented as a known gap in
`app/api/media/credits/book/route.ts`). The rewards bank can't ship until this is fixed; fixing
it also repairs the current feature.

---

## 1. What exists today (grounded)

| Piece | Where | State |
|---|---|---|
| Free-hours "wallet" | `studio_credits` (hours_granted/used, cost_basis_cents) | ✅ exists |
| Free-deliverables wallet | `media_credits` (qty_granted/redeemed) | ✅ exists |
| Redeem hours → booking | `/api/media/credits/book` → writes `bookings.total_amount = 0` + `studio_credit_redemptions` row + decrements hours | ✅ exists |
| Redeem media → session | media session scheduling against `media_credits` | ✅ exists |
| Session price math | `lib/utils.ts calculateSessionTotal` (room×hours×surcharges; 50% deposit) | ✅ exists |
| Engineer payout | `Accounting.tsx computeEarnings`: `total_amount × ENGINEER_SESSION_SPLIT(0.60)` | ⚠️ **pays $0 on comped/credit sessions** |
| Media payout | `media_session_bookings.engineer_payout_cents` (admin-typed) or `media_sales` split | ✅ works, manual |
| Studio booking discount | `bookings.coupon_code`/`discount_amount` columns exist but **unused** | ❌ net-new |
| Rewards grants/credits | `reward_grants` + issuance → studio_credits/media_credits (this branch) | ✅ built |

**The gaps to close:** (a) pay staff on comped/discounted work, (b) apply reward *discounts* to
studio bookings, (c) surface the rewards cost in accounting.

---

## 2. The "bank" — one balance the customer trusts

A single **Rewards Balance** view (the Hub "Perks" tab already started) shows everything the
user can spend, pulled from the two existing wallets + active discount grants:

- **Free studio hours** — `studio_credits` rows where `cost_basis_cents = 0` (reward-issued) +
  any prepaid hours. Shown as "X hours available."
- **Free deliverables** — `media_credits` (free short, music video, photo session, cutdowns).
- **Active discounts** — from `reward_grants` (spend tier %, MV %, referral %, $ credit), via
  `activeDiscountsForOwner` (best-of, never stack).

Each item shows: what it is, its value, and its **expiry** (90-day clock on issued free work).
"Booked" items move to a history list. This is the "know exactly what you have" surface.

---

## 3. Redemption at booking — the correct charge

Three redemption types, each with exact charge math:

### 3a. Free studio hours (already works — reuse)
Customer books and applies free hours → the existing `/api/media/credits/book` flow:
`bookings.total_amount = 0`, `studio_credit_redemptions` row, hours decremented. **No change to
the charge mechanics.** (The fix is purely in §4 — paying the engineer.)
- *Partial:* if they book 3 hrs with only 1 free hour, charge the other 2 at the normal rate
  (today the credit flow is all-or-nothing whole-hours; extend to "N free + remainder paid").

### 3b. Reward discount on a paid studio booking (net-new)
At checkout, look up `activeDiscountsForOwner` → the single best % (never stacked). Apply:
```
gross  = calculateSessionTotal(...).total      // full price of the work
charge = round(gross * (1 - bestPct/100))      // what the customer pays
bookings.discount_amount = gross - charge       // record the discount (column exists)
bookings.total_amount    = charge               // revenue
bookings.service_value_cents = gross            // NEW: the full value (for payroll, §4)
```
Mark the reward_grant `redeemed` (so it can't be reused). Deposit = 50% of `charge`.

### 3c. Free deliverable (already works — reuse)
Free short/video/photo redeem `media_credits` against a media session (existing flow). The §4
payout rule applies to the team instead of the engineer.

**New column:** `bookings.service_value_cents` = the full undiscounted value of the work, set on
EVERY booking (= `total_amount` for normal bookings; = gross for discounted; = hours×rate for
comped). This single field is what makes payroll correct everywhere.

---

## 4. Paying the employee (the crux)

Change the payroll basis from "what was charged" to "the value of the work":

```
ENGINEER PAYOUT  = service_value_cents * 0.60        // always — full value of the work
STUDIO REVENUE   = total_amount                       // what the customer actually paid
STUDIO NET       = total_amount - engineer_payout     // can be negative on a comp
REWARDS COST     = service_value_cents - total_amount // the value we gave away
```

Worked examples (Studio B, $50/hr; 60/40 split):

| Scenario | Hours | Gross (value) | Charged | Engineer paid | Studio net | Rewards cost |
|---|---|---|---|---|---|---|
| Normal 3hr | 3 | $150 | $150 | **$90** | +$60 | $0 |
| 25%-off reward | 3 | $150 | $112.50 | **$90** | +$22.50 | $37.50 |
| Free 1hr reward | 1 | $60 | $0 | **$36** | −$36 | $60 |

The engineer is made whole in every case; the studio absorbs the reward (smaller margin, or a
real out-of-pocket rewards/marketing cost on a full comp). This matches the locked rule:
**studio-session discounts come from the studio's cut; the engineer is paid full.**

### Media differs (per earlier decision)
- **Comped media** (free music video): the team is paid their normal cut of the **full value**
  from the rewards budget (`engineer_payout_cents` set to the full-value share). Revenue $0.
- **Discounted media**: **proportional** — the 65/35 (or media-worker) split is computed on the
  **discounted gross**, so team and studio both earn a little less ("everyone shares it").

---

## 5. Accounting scenarios (what the books show)

`computeEarnings` (and the accounting API) gain a **Rewards / Marketing** cost line:

- **Revenue** = Σ `total_amount` (unchanged — comps add $0, discounts add the reduced amount).
- **Engineer/team pay** = Σ `service_value_cents × split` (the fix — paid on value, not charge).
- **Rewards cost** = Σ `(service_value_cents − total_amount)` over reward-flagged bookings — a
  new expense bucket so the P&L honestly shows "we spent $X giving away rewards this period."
- Payroll balance (earned − paid) already keyed by `user_id`/`normalizeName` — unchanged, just
  fed the corrected per-session pay.

Net effect: the owner sees real revenue, correct staff pay, and a clean "rewards cost" number —
so a free hour visibly costs the studio the engineer's pay, exactly as you asked.

---

## 6. Build plan (after sign-off)

1. **Migration 067**: `bookings.service_value_cents` (backfill = `total_amount` for existing
   rows; for existing credit redemptions, hours×rate). A `reward_redemptions` link (or reuse
   `studio_credit_redemptions` + a `reward_grant_id` on bookings) so a booking knows which
   reward funded it.
2. **Booking create/credit flows**: set `service_value_cents`; apply best-of discount (3b);
   mark the grant `redeemed`; support "N free hours + paid remainder" (3a partial).
3. **`computeEarnings`**: pay on `service_value_cents × split`; add the Rewards-cost bucket;
   media comp/discount handling (full vs proportional).
4. **Hub bank view**: finalize the Perks balance (hours + deliverables + discounts + expiry).
5. **Verify**: replay the worked examples (§4) against real data on the branch; reconcile a
   known credit session's payout before/after.

Each step is independently testable; nothing touches `main` until you approve the money rules.

---

## 7. Decisions for Cole

1. **Payout-on-value rule (§4):** engineer always paid 60% of the full session value; rewards
   reduce revenue, never pay; comp = a real rewards-budget cost. ✅ confirm this is right.
2. **Comped session value** = hours × the standard room rate (the would-be price). OK, or use
   the credit's `cost_basis_cents` when present?
3. **Rewards cost bucket** shown in Accounting as its own expense line. ✅?
4. **Partial free-hours** (1 free hour on a 3-hour booking → pay the other 2) — build it, or keep
   free-hour redemptions whole-session only for now?
5. **Existing $0 credit sessions** that already happened — recompute and pay those engineers
   retroactively (fixes the current bug), or only apply the new payout rule going forward?
