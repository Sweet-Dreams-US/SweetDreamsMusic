# Booking Rush Fee + Charge-on-Accept Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This touches the LIVE payment flow for a running studio with real upcoming sessions — every phase must keep existing bookings working. Verify with `npx tsc --noEmit` + `npm run build` after every task, and run the audit gate (Phase 6) before shipping each phase.

**Goal:** Turn the flat "same-day fee" into a tiered "booking rush fee," allow last-minute booking, and move the deposit charge from booking-time to engineer-accept-time (with a payment-failure repayment failsafe) — so nothing is charged and no free hour is consumed until an engineer actually locks the session in.

**Architecture:** Self-serve studio bookings stop charging up front. At booking the customer's card is **saved** (Stripe SetupIntent) and a booking is created in a new `requested` state — no money moved, slot non-exclusive (first-come-first-serve). When an engineer **accepts**, the saved card is **charged off-session**; success → `confirmed` (slot locked); failure after 2 tries → `payment_pending` (engineer's acceptance stands, but the session is NOT on the calendar) and the customer is emailed a token repayment link that, when paid, flips it to `confirmed`. The single price engine `priceSessionFromConfig` gains a tiered rush fee computed from hours-until-session; the free-hour reward value becomes length-dependent ($60 for 1hr, $50 for 2+hr).

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + RLS), Stripe (SetupIntent + off-session PaymentIntent + Checkout), Resend (email), Vercel. Eastern time via `toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })`.

---

## Locked decisions (the spec — confirmed with Cole 2026-06-22)

### Rush fee (replaces "same day fee"; studio sessions only, NOT media)
Tier by **hours between now and session start** (Eastern), **per booked hour**, **stacks** with night/after-hours fees, **bands exempt**:

| Session starts in… | Rush fee/hr |
|---|---|
| `< 2 hrs` | **$30** |
| `>= 2 and < 4 hrs` | **$20** |
| `>= 4 and < 12 hrs` | **$10** |
| `>= 12 hrs` | **$0** |

- No calendar-day logic — purely hours-until-start. Examples: 11:50pm→1am = $30 (+ late-night fee, double-stacked); 12:10am→8am = $10; 11:50pm→next-day 9am (≈9.2h) = $10; anything 12h+ out = $0.
- User-facing name everywhere: **"Booking Rush Fee"** (never "same day fee").

### Buffer
- **Remove** the 3-hour same-day booking buffer entirely. Customers may book right up to the session start (24h booking). The rush fee + engineer-acceptance gate are the controls.

### Charge timing (the foundation)
- **No charge at booking.** Card is saved at booking. **Charge happens when an engineer accepts.**
- Until accepted, the slot is **not exclusively held** — "anybody can book that time, first come first serve." Whoever an engineer accepts (and whose card charges) first wins the slot.
- The **free hour** (and any rush/after-hours fee) is only **consumed/charged on accept**, never at booking.

### Payment-failure failsafe
- On accept, charge the saved card. Retry once on failure (**2 attempts total**).
- If both fail → booking goes to **`payment_pending`**: the engineer's acceptance is recorded, but the session is **NOT** on the calendar / locked. Email the customer a **token repayment link**: *"Your engineer confirmed your session, but payment failed — repay here to lock it in."* Paying the link → `confirmed` + locked.

### Free-hour reward value
- Length-dependent, flat by length: **$60** if the session is exactly 1 hour, **$50** if 2+ hours. (Replaces the current flat $50 `FREE_HOUR_VALUE_CENTS`.)
- Studio A is allowed for a free hour but the $60/$50 only covers that much — the customer pays the Studio-A base difference (already how "pay any base above the credit" works). Rush/after-hours/guest fees are **never** covered by the free hour.

---

## Current state (from code exploration — file:line anchors)

- **Fee today:** flat `PRICING.sameDaySurcharge = 1000` (`lib/constants.ts:68`) + DB `studio_room_surcharges` row `kind='same_day'`. Applied per hour in **two** engines: `lib/utils.ts:87` `calculateSessionTotal()` (legacy) and `lib/studio-config.ts:86` `priceSessionFromConfig()` (DB-driven, used in production). Parity kept by `scripts/studio-pricing-golden.ts`.
- **Same-day determination:** `app/api/booking/create/route.ts:194` string-compares Eastern dates; the 3-hour buffer is enforced in `app/api/booking/availability/route.ts:4` (`SAME_DAY_BUFFER_HOURS=3`) and re-checked in `create`.
- **Free hour:** `FREE_HOUR_VALUE_CENTS = 5000` flat (`lib/credit-redemption-pricing.ts:54`); discount = `creditHoursApplied * 5000` (`lib/credit-redemption-pricing.ts:123`). Used in `components/booking/BookingFlow.tsx:7`, `app/api/booking/create/route.ts:9`.
- **Base rates (length-dependent, already):** `ROOM_RATES_SINGLE` 1hr = $80 A / $60 B; `ROOM_RATES` 2+hr = $70 A / $50 B; Sweet-4 flat (`lib/constants.ts:133-141`). `basePerHour` chosen by hours in both engines.
- **Charge today:** `app/api/booking/create/route.ts` builds a Stripe **Checkout** that **captures the deposit immediately**; webhook (`app/api/booking/webhook/route.ts`) inserts the booking on `checkout.session.completed`.
- **Lifecycle / acceptance (ALREADY EXISTS):** `lib/booking-status.ts` — `pending_deposit` (invite, slot not held) → `pending` (deposit paid, awaiting engineer) → `confirmed` (engineer claimed) → `completed`/`cancelled`. `paidBookingStatus(engineerName)` returns `confirmed` if an engineer is named else `pending`. Engineer accept = `POST /api/booking/respond` (action `accept`) — atomic `update(...).is('engineer_name', null)`, sets `status='confirmed'`. DB CHECK (`migration 072`): `status='confirmed' ⇒ engineer_name NOT NULL`.
- **Reward restore on cancel (ALREADY EXISTS):** `restoreRewardsOnCancel()` (`lib/rewards-issue.ts:473`) gives back studio-credit hours + re-issues grants; called from admin + engineer cancel paths.
- **Dashboard (ALREADY shows status colors):** `app/dashboard/page.tsx:194-267` — pending=yellow "Awaiting Engineer", confirmed=accent, etc. (`lib/booking-status.ts` label/color helpers).
- **No Stripe refunds are ever issued**; cancelled-with-deposit is currently counted as kept revenue (`app/api/admin/accounting/route.ts:29`). **No customer reschedule-with-repricing flow exists** (only a reschedule-request flag).

---

## Target booking state machine (charge-on-accept)

```
                       book (card saved, no charge, slot soft)
  [requested] ─────────────────────────────────────────────────────────►
       │  engineer accepts → charge saved card (≤2 tries)
       ├── charge OK ──────────────────────────────► [confirmed]  (slot LOCKED, deposit captured, free hour consumed)
       └── charge fails ×2 ───────────────────────► [payment_pending] (engineer accepted, NOT on calendar, repay link sent)
                                                          │ customer pays repay link
                                                          └────────────► [confirmed]
  [confirmed] ── session done ─► [completed]
  [confirmed]/[requested]/[payment_pending] ── cancel ─► [cancelled]  (reward restored)
```

- **New statuses:** `requested` (card on file, unpaid, awaiting engineer, slot non-exclusive) and `payment_pending` (engineer-accepted, charge failed, awaiting customer repayment, NOT calendar-locked).
- **Slot exclusivity:** only `confirmed` (and `completed`) hard-blocks availability. `requested` does NOT block (first-come-first-serve). `payment_pending` soft-holds the slot for a repayment window (default: until session start or 60 min, whichever sooner) so the customer can repay without losing it; after the window, it reopens.
- **Backward-compat:** existing `pending` (deposit-already-paid, awaiting engineer) bookings remain valid and behave as today (they're already paid; engineer accept just confirms, no charge). The new charge-on-accept path only governs **newly created** bookings. `paidBookingStatus` semantics preserved for legacy rows.

---

## Stripe flows

**At booking (`/api/booking/create` rewrite):**
1. Resolve/create the Stripe Customer for the user (by email). 
2. Create a **Checkout Session in `mode: 'setup'`** (or a SetupIntent + Elements) to collect + save the card to the Customer. No charge. Metadata carries the full priced booking (room, date, startHour, duration, guests, rush amount, free-hour intent, computed deposit + total).
3. Webhook `checkout.session.completed` (setup mode) / `setup_intent.succeeded` → insert the booking row as `status='requested'` with `stripe_customer_id` + `stripe_payment_method_id` saved, `deposit_amount`/`total_amount`/`booking_rush_fee_amount` computed, `engineer_name=NULL`. Slot NOT blocked.

**At engineer accept (`/api/booking/respond` action=accept, extended):**
1. Atomic guard: the booking is `requested` and no other booking is `confirmed`/`payment_pending` for the same room+time window (first-come-first-serve race).
2. Re-price server-side from stored booking fields (never trust stale metadata for the charge).
3. Create an **off-session PaymentIntent** (`confirm:true`, `off_session:true`, saved PM) for the deposit. **Retry once** on a card error.
4. **Success** → set `engineer_name`, `status='confirmed'`, `claimed_at`, capture deposit fields, **consume free hour now** (decrement `studio_credits` / mark grant redeemed), send confirmation emails. Slot is now locked.
5. **Failure ×2** → set `engineer_name`, `status='payment_pending'`, generate a `repayment_token`, email the customer the repayment link. Do NOT consume the free hour yet, do NOT lock the calendar.

**At repayment (`/api/booking/repay/[token]` + public page):**
1. Resolve booking by token only. Re-price. Create a normal Checkout (immediate capture) for the deposit.
2. Webhook → `status='confirmed'`, consume free hour, lock slot, send confirmation.

---

## File map

**New:**
- `lib/rush-fee.ts` — `rushFeePerHourCents(now: Date, sessionStartEastern: {date,startHour}): number` (the 30/20/10/0 helper) + `RUSH_FEE_TIERS` constant + `BOOKING_RUSH_LABEL`.
- `app/api/booking/repay/[token]/route.ts` — token repayment Checkout creator.
- `app/booking/repay/[token]/page.tsx` — public repayment page (no login), mirrors `app/contract/[token]`.
- `supabase-migrations/092_charge_on_accept.sql` — new statuses, card-on-file columns, repayment token, rush-fee columns/rename, slot-hold window.

**Modified (key):**
- `lib/studio-config.ts` (`priceSessionFromConfig`) + `lib/utils.ts` (`calculateSessionTotal`) — replace `sameDay: boolean` with `rushPerHourCents: number`; rename `sameDayFee` → `bookingRushFee` in the result types.
- `lib/credit-redemption-pricing.ts` — `FREE_HOUR_VALUE_CENTS` → length-dependent `freeHourValueCents(hours)`.
- `lib/booking-status.ts` — add `REQUESTED`, `PAYMENT_PENDING` statuses + labels + colors; update `paidBookingStatus` callers.
- `app/api/booking/create/route.ts` — Checkout(charge) → Checkout(setup)/save-card; create `requested`; remove buffer; compute rush via `rush-fee.ts`.
- `app/api/booking/availability/route.ts` — remove `SAME_DAY_BUFFER_HOURS` blocking; only `confirmed`/`completed`/(held)`payment_pending` block slots.
- `app/api/booking/respond/route.ts` — add off-session charge + 2-try retry + `payment_pending` failsafe + free-hour consume-on-accept + slot race guard.
- `app/api/booking/webhook/route.ts` — handle setup-mode completion (insert `requested`), the on-accept PaymentIntent result, and the repay Checkout; rename metadata `same_day*` → `booking_rush*`.
- `components/booking/BookingFlow.tsx`, `components/dashboard/PricingCalculator.tsx`, `app/pricing/page.tsx`, `components/engineer/CreateInvite.tsx` — rush copy + tiered display; card-save UX in BookingFlow.
- `app/dashboard/page.tsx` + `lib/booking-status.ts` — show `requested` ("Awaiting engineer — not locked in until accepted") + `payment_pending` ("Engineer confirmed — payment needed, repay to lock in") with distinct colors + explanatory copy.
- `components/admin/BookingManager.tsx`, `components/admin/StudiosManager.tsx` — rename + show new states.
- `scripts/studio-pricing-golden.ts` — update parity goldens for tiered rush + new free-hour value.

---

## Phases (each independently shippable + verifiable)

### Phase 1 — Pricing core (NO payment-model change yet; safe, isolated)
Builds the rush-fee helper, swaps both engines to tiered rush, removes the buffer, applies the free-hour value change, and renames — all on **today's** charge-up-front flow. Ships value immediately and is fully golden-testable. (Caveat surfaced to Cole: until Phase 2, a rush booking is still charged up front; mitigated because Phase 2 follows immediately.)

- **Task 1.1** `lib/rush-fee.ts` — `rushFeePerHourCents()` + `RUSH_FEE_TIERS` + golden unit test (`scripts/rush-fee-golden.ts`) covering every boundary (1.9h→3000, 2h→2000, 3.9h→2000, 4h→1000, 11.9h→1000, 12h→0) and the Eastern-time computation.
- **Task 1.2** `priceSessionFromConfig` + `calculateSessionTotal`: replace `sameDay`/`isSameDayBooking` input with `rushPerHourCents`, rename result field `sameDayFee`→`bookingRushFee`, apply per hour, keep stacking + band-exempt. Update `scripts/studio-pricing-golden.ts`.
- **Task 1.3** `lib/credit-redemption-pricing.ts`: `FREE_HOUR_VALUE_CENTS` → `freeHourValueCents(hours)` (6000 if hours===1 else 5000); update all callers + golden examples.
- **Task 1.4** Call sites compute rush from `rush-fee.ts`: `app/api/booking/create/route.ts`, `app/api/media/credits/book/route.ts`, `BookingFlow.tsx`, `PricingCalculator.tsx`, `CreateInvite.tsx`, `app/pricing/page.tsx`. Pass `now` + session start.
- **Task 1.5** Remove the 3-hour buffer: `availability/route.ts` (`SAME_DAY_BUFFER_HOURS`) + the buffer reject in `create/route.ts` + `same_day_buffer_hours` config seed.
- **Task 1.6** Rename all user-facing "same day"→"Booking Rush Fee" (BookingFlow 520/915/1020, pricing page 167/173/182, PricingCalculator 140/150, CreateInvite, BookingManager 658/1354, quotes clause, redeem-session error). Keep DB column names but relabel; add `booking_rush_fee_amount` semantics.
- **Task 1.7** Migration `092` part A: add `booking_rush_fee_amount` (or repurpose `same_day_fee_amount` with a comment), keep old columns for back-compat.
- **Task 1.8** Golden + tsc + build + Phase-6 audit gate; ship.

### Phase 2 — Charge-on-accept foundation (the core)
- **Task 2.1** Migration `092` part B: `bookings` add `stripe_customer_id`, `stripe_payment_method_id`, `repayment_token`, `slot_hold_expires_at`; widen `status` CHECK to include `requested`, `payment_pending`; relax the `confirmed⇒engineer` CHECK to also allow `payment_pending⇒engineer`. Backfill existing rows: leave as-is (legacy paid bookings keep working).
- **Task 2.2** `lib/booking-status.ts`: add `REQUESTED='requested'`, `PAYMENT_PENDING='payment_pending'` + labels/colors; helper `slotBlockingStatuses()` = `['confirmed','completed', payment_pending-while-held]`.
- **Task 2.3** `create/route.ts`: switch deposit Checkout → **setup-mode** card save; stop charging; stamp full booking metadata.
- **Task 2.4** `webhook/route.ts`: handle setup completion → insert `status='requested'` with saved customer/PM; do NOT block slot; do NOT consume free hour.
- **Task 2.5** `availability/route.ts`: only hard-block slots that are `confirmed`/`completed`/held-`payment_pending` (first-come-first-serve for `requested`).
- **Task 2.6** `respond/route.ts` accept: slot race guard → off-session PaymentIntent (confirm+off_session) → retry once → success `confirmed` + consume free hour + emails; fail×2 → `payment_pending` + repayment token + email.
- **Task 2.7** Repayment: `app/api/booking/repay/[token]/route.ts` + `app/booking/repay/[token]/page.tsx` + webhook branch → `confirmed` + consume free hour + lock.
- **Task 2.8** Emails (`lib/email.ts`): `sendBookingRequestedEmail` (card saved, awaiting engineer), `sendPaymentFailedRepayEmail` (engineer confirmed, repay link), update confirmation email to fire on accept.
- **Task 2.9** Free-hour consume-on-accept: move `studio_credits`/grant decrement from booking-create to the accept/repay success path; ensure `restoreRewardsOnCancel` still covers `requested`/`payment_pending` cancels (no consume yet = nothing to restore).
- **Task 2.10** Golden + tsc + build + **Stripe test-mode integration script** + Phase-6 audit gate; ship.

### Phase 3 — Dashboard + UX for new states
- **Task 3.1** `app/dashboard/page.tsx` + `lib/booking-status.ts`: render `requested` ("Awaiting engineer — your session isn't locked in until an engineer accepts it") in a distinct (amber/outline) color, and `payment_pending` ("Your engineer confirmed — payment didn't go through. Repay to lock it in" + repay button) in red/attention. 
- **Task 3.2** Engineer UI (`EngineerSessions.tsx`): show that accepting will charge the customer; surface charge-failed bookings.
- **Task 3.3** Admin (`BookingManager.tsx`): show `requested`/`payment_pending` + a "resend repay link" action.

### Phase 4 — Reschedule-with-repricing (customer self-serve)
- **Task 4.1** Allow a customer to change the time of a `requested`/`payment_pending`/`confirmed`-unaccepted booking; re-price; charge difference (on accept) or credit leftover to `studio_credits`. (Smaller; can follow.)

---

## Test & audit strategy (Cole: "many many tests and audits")

1. **Golden/parity unit scripts** (`tsx`): `scripts/rush-fee-golden.ts` (every tier boundary + Eastern tz), updated `scripts/studio-pricing-golden.ts` (rush stacking with night fees; band-exempt; free-hour $60/$50; Studio A difference). Run in CI-style before each ship.
2. **Stripe test-mode integration script**: simulate book→save-card→engineer-accept→charge-success and →charge-fail×2→payment_pending→repay→confirmed, asserting statuses, amounts, slot-blocking, and free-hour consume/restore at each step.
3. **Scenario matrix** (must all pass): regular advance booking; rush <2/2-4/4-12/12+; rush + night double-stack; free-hour 1hr ($60) and 2+hr ($50); free-hour in Studio A (pay difference); free-hour on a rush slot (rush still charged, free hour only on accept); two customers race the same slot; engineer accept with declined card → payment_pending → repay; cancel at each state restores reward + never strands money; **existing already-paid `pending`/`confirmed` bookings unchanged**.
4. **Adversarial audit phase** (subagents): per booking path, verify money is never moved before accept, the free hour is never consumed before accept, no double-charge on retry, no double-booking on race, and no regression to upcoming real sessions.

---

## Rollout / backward-compat safety

- Migration `092` is **additive** (new columns + widened CHECK); never drops the legacy `same_day_fee*` columns or breaks existing `pending`/`confirmed` rows.
- The charge-on-accept path applies only to **newly created** bookings; in-flight already-paid bookings keep their semantics (engineer accept just confirms, no charge attempt — guard on `stripe_payment_method_id IS NULL`).
- Each phase ships behind a verified build + golden + audit; Phase 1 is reversible (pricing only); Phase 2 is the high-risk one and gets the Stripe integration script + audit before shipping.

---

## Risks

1. **Charging the wrong amount / double-charge on retry** → idempotency key on the off-session PaymentIntent; re-price from stored fields, never stale metadata.
2. **Slot double-booking under first-come-first-serve** → atomic confirm guard (unique-ish check on room+time for blocking statuses) inside the accept transaction.
3. **Off-session charge declines (CashApp/Apple Pay)** → the explicit `payment_pending` + repayment-link failsafe (the whole point).
4. **Breaking upcoming real sessions** → additive migration + legacy-row guard + audit gate; do NOT touch rows with `stripe_payment_method_id IS NULL`.
5. **Free hour double-consumed or stranded** → consume ONLY on confirm; `restoreRewardsOnCancel` covers cancels; `requested`/`payment_pending` cancels have nothing to restore.
