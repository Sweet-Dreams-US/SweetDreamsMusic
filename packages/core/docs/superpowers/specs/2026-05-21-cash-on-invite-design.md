# Cash-on-Invite — Design Spec

**Date:** 2026-05-21
**Status:** Approved design — ready for implementation planning

## 1. Goal

Let a client who receives a Stripe-payment invite choose to **pay cash instead**, and let the engineer **record that cash when it arrives** to officially lock the slot — eliminating the current "cancel the booking and resend a new invite" workaround. A cash booking holds the slot **only once cash is recorded**; until then the time stays open for anyone.

## 2. Background / Current behavior

Engineers create session invites via `POST /api/booking/invite`, choosing cash or online:

- **Online (Stripe):** booking created as `pending_deposit`. This does **not** hold the slot — `availability` only blocks `confirmed` + `pending`. Client pays via `/api/booking/invite/pay` → Stripe webhook (`invite_deposit`) flips status to `confirmed` → slot held.
- **Cash (chosen upfront):** booking created as `confirmed` immediately with `deposit_amount: 0`, `$0` collected — so it **holds the slot before any cash is in hand**.

Problems:
1. The invite page (`app/book/invite/[token]/page.tsx`) only offers "Pay Deposit" (Stripe). A client who wants to pay cash has no path → the engineer cancels and recreates the booking as a cash invite.
2. `POST /api/booking/record-payment` (how engineers log cash) updates balance + `cash_ledger` but **never changes `status`** — recording cash on a pending booking does not confirm/lock it.
3. The upfront-cash path holds the slot instantly with `$0` collected — opposite of the desired "no hold until cash in hand."

## 3. Decisions (locked with owner)

1. **Cash hold rule:** A cash booking does **not** hold the slot until the engineer records received cash. Applies to **both** the client-picks-cash path and the engineer upfront-cash invite (unified). Tradeoff accepted: a cash client can lose the slot to someone who pays first, until they pay.
2. **Engineer alert:** email **and** an in-app "Cash pending" badge.
3. **Slot-taken case:** if the slot has been taken by the time the engineer records cash, **block the record entirely** — the engineer must reschedule the cash booking to an open time first. Never silently double-book.
4. **Cash-intent representation:** a new `deposit_method` column (`'card'` default, `'cash'`). No inference from `deposit_amount`.
5. **No toggle:** offering "Pay Cash" *is* cash-deposit acceptance — there is no per-engineer or per-studio on/off switch.

## 4. Status model

Two existing statuses carry the whole flow; no new status is introduced.

| Status | Meaning | Holds slot? |
|---|---|---|
| `pending_deposit` | invite sent, nothing received (card OR cash) | No (availability ignores it) |
| `confirmed` | deposit received — card via Stripe webhook, OR cash recorded by engineer | Yes |

The only difference between card and cash is **who flips `pending_deposit → confirmed`**: Stripe's webhook (card) vs. the engineer's record-cash action (cash).

New marker column `deposit_method`:
- `'card'` (default) — client intends to pay the deposit online.
- `'cash'` — client (or engineer, upfront) intends to pay the deposit in cash.

## 5. Schema change

**Migration `063_deposit_method.sql`** (additive, low-risk):

```sql
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS deposit_method TEXT NOT NULL DEFAULT 'card';
```

- Defaulted + `NOT NULL` so every existing row gets `'card'` automatically; nothing reads it as required.
- No backfill needed. No existing query filters on it.

## 6. Components

### 6.1 Client picks "Pay Cash" — invite page + new route

- `app/book/invite/[token]/page.tsx`: for a `pending_deposit` booking, render **two** actions: "Pay Deposit (Card)" (existing `handlePayDeposit`) and **"Pay Cash at Studio."**
- "Pay Cash" calls a **new** route `POST /api/booking/invite/choose-cash` which:
  - validates the invite token exactly like `invite/pay` (token must match `admin_notes`);
  - requires an authenticated user (same gate as the card path) and links the booking to their account (mirrors `invite/pay`'s name/email linking);
  - sets `deposit_method = 'cash'` (status stays `pending_deposit` — **no hold, no charge**);
  - triggers the engineer alert (§6.3).
- Client then sees a clear message: *"Pay your $X deposit in cash to your engineer. Your time isn't locked in until we receive it, so bring it as soon as you can."*
- Login gate: unchanged — the page already requires login before any pay action, so the cash button lives behind the same gate.

### 6.2 Engineer's upfront cash invite aligns

- `app/api/booking/invite/route.ts`, `paymentMethod === 'cash'` branch: change the insert from `status: 'confirmed'` to `status: 'pending_deposit'` + `deposit_method: 'cash'`, and set a real `deposit_amount`/`remainder_amount` split (not `deposit_amount: 0`) so the recorded cash has a deposit target. The online branch also sets `deposit_method: 'card'` explicitly.
- Net: an upfront cash invite no longer auto-confirms; it waits for recorded cash like the client-cash path.
- The invite email for the cash case keeps informing the client cash is due; copy is reviewed so it no longer implies the slot is already locked.

### 6.3 Engineer notification (email + badge)

- **Email:** a new `lib/email.ts` helper (e.g. `sendCashChosenAlert`) emails the assigned engineer (fall back to SUPER_ADMINS if unassigned): *"[Client] chose to pay cash for their [date/time] session — collect the deposit and record it to lock their slot."* Links to the engineer's sessions view.
- **Badge:** in `components/engineer/EngineerSessions.tsx` (and the admin `BookingManager.tsx` list for parity), a booking with `status === 'pending_deposit' && deposit_method === 'cash'` shows a **"Cash pending"** badge. Requires adding `deposit_method` to the row types/selects these components already use.

### 6.4 Record cash → confirm + lock (with slot-taken guard)

When an engineer records a **cash** payment on a `pending_deposit` booking, it must confirm + hold the slot. This is distinct from recording cash on an already-`confirmed` booking (remainder paydown), which is unchanged.

Mechanism (resolved in the plan; preferred shape):

- The record-cash path detects `status === 'pending_deposit'`. Before confirming, it runs the **same conflict check** the booking-create flow uses for the booking's `start_time`/`duration`/`room` against other `confirmed`/`pending` bookings (and studio-wide blocks).
  - **Conflict found → block:** return an error the UI surfaces as *"This time was booked by someone else — reschedule this cash booking to an open time first."* No status change, no double-book.
  - **No conflict → confirm:** set `status = 'confirmed'`, credit the recorded cash per the money rules in §7 (deposit satisfied, `remainder = total − cash received`), and log to `cash_ledger` exactly as record-payment does today (engineer owes business the cash).
- Recording cash on a `confirmed` booking keeps today's behavior precisely (remainder paydown + ledger). The two semantics are branched on status so the accounting stays correct.

## 7. Money semantics (correctness)

- **`pending_deposit` cash booking** (`total = T`, `deposit = D`, `remainder = T − D`, `actual_deposit_paid = 0`): recording cash of amount `A` confirms the booking and credits `A` against the total. `actual_deposit_paid` is set to the deposit portion (`min(A, D)`) and `remainder_amount` becomes `max(0, T − A)`. So recording exactly the deposit leaves `remainder = T − D` (post-session balance unchanged); recording the full amount leaves `remainder = 0`. The deposit is **not** double-counted against `remainder`. Exact rounding + edge handling (under-deposit, overpayment) is finalized in the plan.
- **`confirmed` booking remainder paydown:** unchanged — `remainder = max(0, remainder − amount)`.
- Every cash record continues to write a `cash_ledger` row (`status: 'owed'`) and a `booking_audit_log` entry, as today.

## 8. Safety / Non-negotiables

- **Card / Stripe path: unchanged.** `invite/pay` and the webhook `invite_deposit` handler are not modified; card deposits confirm exactly as today.
- **Remainder payments on confirmed bookings: unchanged.**
- **Availability logic: unchanged** — it already ignores `pending_deposit`; this feature relies on that existing behavior, it does not edit `availability` or `availability/month`.
- **Booking-create conflict logic: reused, not rewritten** — the record-cash guard calls the same conflict primitive (extracted/shared if needed) rather than introducing a second source of truth.
- Only intentional behavior change to an existing flow: the upfront cash invite no longer auto-confirms (§6.2), per the owner's locked decision.
- Booking/session live flow must not break (live sessions are sacred).

## 9. Verification

- `npx tsc --noEmit` — 0 errors.
- `npm run build` — exit 0.
- `npx eslint` on every new/changed file — 0 errors.
- Manual smoke (logged in appropriately):
  1. Engineer creates a cash invite → booking is `pending_deposit`, slot shows **open** on the calendar.
  2. Client opens a Stripe invite → sees both buttons → clicks "Pay Cash" → sees the cash message; engineer gets email + "Cash pending" badge; slot still open.
  3. Engineer records the cash → booking `confirmed`, slot now **held**; `cash_ledger` row written; `actual_deposit_paid` correct; `remainder` correct.
  4. Conflict case: a second booking takes the slot, then the engineer tries to record cash → **blocked** with the reschedule message; no double-book.
  5. Card path regression: a normal Stripe invite still pays + confirms exactly as before.
- `git diff --stat` confirms only intended files changed; no edits to `availability`, the Stripe webhook card branches, or unrelated booking/session/payment code.

## 10. File footprint (anticipated)

- **New:** `supabase-migrations/063_deposit_method.sql`; `app/api/booking/invite/choose-cash/route.ts`; a `lib/email.ts` helper.
- **Modified:** `app/book/invite/[token]/page.tsx` (Pay Cash button + messaging); `app/api/booking/invite/route.ts` (cash branch → `pending_deposit` + `deposit_method`; online branch sets `'card'`); `app/api/booking/record-payment/route.ts` (pending→confirmed + conflict guard + deposit semantics); `components/engineer/EngineerSessions.tsx` and `components/admin/BookingManager.tsx` (Cash-pending badge + `deposit_method` in row types/selects).
- **Untouched:** `availability` routes, Stripe webhook card/async confirm branches, `invite/pay`.

## 11. Out of scope (future)

- Grace-window auto-hold for cash (owner chose strict no-hold).
- Any per-engineer/per-studio cash toggle.
- Notifying the cash client if their slot gets taken before they pay (they're told up front it isn't held; proactive "you lost your slot" notice is a possible later nicety).
