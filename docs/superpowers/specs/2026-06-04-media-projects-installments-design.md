# Media Projects — installment payment plans + contract + shared management (design spec)

> Branch `feat/media-projects` off `main` (LIVE Sweet Dreams). Merges to `main` after Cole tests.
> Reworks the admin "Media → New session" flow into a **managed media project**: a custom installment payment plan, per-installment payment links the manager can send/resend, a contract the artist must agree to, and a shared view where the artist sees the project and self-pays each stint.

## Decisions (locked in brainstorming)
1. **Payment plan = fully custom lines** — manager adds each stint manually: label + amount + optional due date. Amounts/timing arbitrary.
2. **Contract = editable terms + "I agree"** — manager writes/edits the project's terms; the artist must click "I agree" (timestamped + recorded) **before the first payment**. No third-party e-sign.
3. **Artist access = pick existing or invite by email** — manager attaches a registered artist OR types a new email; a new artist is invited to create an account and see the project (artist logs in to view/pay).

## Concept
No new parallel system: a `media_bookings` row **is** the project (it already carries price, shoot sessions, deliverables, messages, audit log, and the artist page `/dashboard/media/orders/[id]`). We add a payment **schedule**, a **contract**, and a tighter shared view. Admin **"New session" → "New project."** Calendar shoots (`media_session_bookings`) stay nested + unchanged.

## Data model
**New table `media_payment_installments`** (one row per stint):
- `id` uuid PK
- `booking_id` uuid NOT NULL → `media_bookings(id)` ON DELETE CASCADE
- `sort_order` int NOT NULL (display + pay order)
- `label` text NOT NULL (e.g. "Deposit", "At filming", "On delivery")
- `amount_cents` int NOT NULL CHECK (>= 0)
- `due_date` date NULL
- `status` text NOT NULL DEFAULT 'pending' CHECK in ('pending','link_sent','paid','void')
- `stripe_payment_link_id` text NULL, `stripe_payment_link_url` text NULL, `stripe_payment_intent_id` text NULL
- `paid_at` timestamptz NULL, `paid_method` text NULL CHECK in ('card','link','cash','venmo','check','other')
- `created_at`/`updated_at` timestamptz DEFAULT now()
- index `(booking_id, sort_order)`; RLS mirrors `media_bookings` (owner/band/engineer read; service-role for admin writes).

**Contract fields on `media_bookings`:** `contract_terms` text NULL, `contract_agreed_at` timestamptz NULL, `contract_agreed_by` uuid NULL → auth.users(id).

**Invariants:**
- When a plan exists, `SUM(amount_cents)` must equal `final_price_cents` (validated on create/edit; exact).
- "Paid so far" for a plan project = `SUM(amount_cents WHERE status='paid')`. This supersedes the deposit/remainder math **only for plan projects**.
- A booking with **no** installment rows = legacy deposit/remainder behavior, completely untouched.

## Backend (reuse existing patterns)
- `POST /api/admin/media/bookings/[id]/installments` — create/replace the plan from an array `[{label, amount_cents, due_date?}]`; validates sum == `final_price_cents`; only allowed while no installment is `paid`/`link_sent` (or replaces only `pending` ones). Audit `payment_plan_set`.
- `POST /api/admin/media/bookings/[id]/installments/[instId]/send-link` — create a Stripe Payment Link for that installment (metadata `{booking_id, installment_id, type:'media_installment'}`), set `status='link_sent'`, store link id/url, email the artist. Re-calling = resend (audit `installment_link_sent` / `installment_link_resent`). Adapts `charge-remainder`/`resend-link`.
- `POST /api/admin/media/bookings/[id]/installments/[instId]/record-payment` — manual (cash/venmo/check/other) → `status='paid'`, `paid_at`, `paid_method`, audit `installment_paid_manual`.
- **Contract:** extend `PATCH /api/admin/media/bookings/[id]` to set `contract_terms`. New `POST /api/media/bookings/[id]/agree` (artist-side; owner/band-member only) → stamps `contract_agreed_at/by`. Audit `contract_agreed`.
- **Artist self-pay:** the installment's Stripe link is shown on the artist page ("Pay now"); reuses the same link/webhook. Gated: blocked until `contract_agreed_at` is set.
- **Invite-by-email:** extend the manual-create flow so a new email creates/invites the artist user and attaches `user_id` (reuse the existing invite/user-creation mechanism; reconcile with how booking invites or `MediaOrders` library picks users).
- **Webhook:** extend `app/api/booking/webhook/route.ts` — detect `metadata.type='media_installment'` + `installment_id` → mark that installment `paid` (`paid_at`, `paid_method='card'|'link'`, `stripe_payment_intent_id`), recompute paid-so-far, audit. Idempotent (event-id + installment already-paid guards).

## Manager UI (`MediaOrders.tsx` + create flow)
- **"New project"** (rename/augment "+ New booking"): pick existing artist OR type a new email; offering/scope + total; then **add installment lines** (label, amount, optional due date) with a running total that must equal the project total; **contract terms** textarea.
- **Project detail:** an **installments table** (label · amount · due · status) with **Send link / Resend / Record payment** per row; contract terms display + agreed/awaiting badge; existing scope/delivery/messaging unchanged.

## Artist UI (`app/dashboard/media/orders/[id]`)
- **Contract** section: terms + one-time **"I agree"** (timestamped). Until agreed, payment is blocked with a clear prompt.
- **Payment schedule:** each stint (label · amount · due · status) + **"Pay now"** (opens the Stripe link) for unpaid stints, in any order. Existing work/sessions/deliverables view unchanged.

## Flow + gating + states
Manager creates project (draft) → artist invited → **artist must "I agree" before the first payment** → artist/manager pay stints in any order via links (or manager records manual) → each paid stint flips to `paid` (webhook by installment id) and rolls into paid-so-far → manager tracks delivery as today. Every action → existing `media_booking_audit_log`. `media_bookings.status` is left as-is (plan/contract are orthogonal to it).

## Reuse vs. new (low-risk on live)
- **Reused:** Stripe Payment Link + resend + record-payment + webhook + audit + email + artist order page + manual-create flow.
- **New:** `media_payment_installments` table + per-installment buttons; contract fields + agree step; invite-a-new-artist-by-email.
- **Out of scope:** formal e-signature; auto-charging saved cards per stint (links + manual only); reusable contract templates (per-project free-text for now).

## Verification / testing
- `npx tsc --noEmit` + `npm run build` clean.
- End-to-end (Cole tests on the branch/preview): create a project for an artist with 3 custom installments summing to the total; write contract terms; artist logs in, agrees, pays stint 1 via link; webhook flips it to paid; paid-so-far updates; manager resends + records a manual payment for another stint; ownership/RLS isolation holds; legacy (non-plan) media bookings still behave exactly as before.
