# Cash-on-Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an invited client choose to pay their deposit in cash; the booking holds the slot only when the engineer records that cash, with a conflict guard that blocks recording if the slot was taken first.

**Architecture:** Reuse the existing two-status model — `pending_deposit` (slot open) → `confirmed` (slot held). Card confirms via the Stripe webhook (unchanged); cash confirms via the engineer's `record-payment` action (new branch). A new `deposit_method` column marks card vs cash for UI/email. No new statuses, no changes to availability or the Stripe path.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (service-role client), Stripe (unchanged), Resend, lucide-react.

**Design spec:** `docs/superpowers/specs/2026-05-21-cash-on-invite-design.md`

---

## Conventions & Notes

**No test framework.** This repo has no Jest/Vitest. Do NOT add one. Each task is verified with `npx tsc --noEmit` (0 errors), `npx eslint <files>` (0 errors), `npm run build` (final task), and manual checks. ESLint forbids `@typescript-eslint/no-explicit-any` — use explicit types, never `any`.

**Do NOT commit.** The owner reviews the full diff before anything commits (a separate, already-built "Command Center" change is also uncommitted in the tree — leave it untouched; this feature touches entirely different files). Skip any commit step.

**Live payment/booking path.** Do not modify: `app/api/booking/availability/route.ts`, `app/api/booking/availability/month/route.ts`, the Stripe webhook's card/async confirm branches (`app/api/booking/webhook/route.ts`), or `app/api/booking/invite/pay/route.ts`. The card flow must behave exactly as today.

**Timezone.** Booking timestamps are Fort Wayne wall-clock stored as UTC. Reuse existing helpers/patterns; do not introduce new timezone math. The conflict check reads `start_time` via `getUTCHours()/getUTCMinutes()`, matching `app/api/booking/create/route.ts`.

**Money units.** All booking money columns are integer **cents**. `record-payment` receives `amount` in **dollars** and converts (`Math.round(amount * 100)`).

---

## File Structure

**Created:**
- `supabase-migrations/063_deposit_method.sql` — adds the `deposit_method` column.
- `app/api/booking/invite/choose-cash/route.ts` — client elects cash on an invite; flips `deposit_method='cash'`, notifies the engineer. No charge, no hold.

**Modified:**
- `app/api/booking/invite/route.ts` — cash branch creates `pending_deposit` (not instant `confirmed`) with a real 50% deposit + `deposit_method='cash'`; online branch sets `deposit_method='card'`.
- `lib/email.ts` — add `sendCashChosenAlert()`.
- `app/api/booking/invite/lookup/route.ts` — add `deposit_method` to the select.
- `app/book/invite/[token]/page.tsx` — "Pay Cash" button + cash-pending view + `deposit_method` in the type.
- `app/api/booking/record-payment/route.ts` — when the booking is `pending_deposit`, run the slot conflict guard, then confirm + apply deposit money-math; otherwise unchanged.
- `app/api/booking/all/route.ts` — add `deposit_method` to the select (feeds the engineer list).
- `components/engineer/EngineerSessions.tsx` — `deposit_method` on the `Booking` type + a "Cash pending" badge.
- `components/admin/BookingManager.tsx` — `deposit_method` on the `Booking` type + a "Cash pending" badge (its API already returns `*`).

---

## Task 1: Migration — `deposit_method` column

**Files:**
- Create: `supabase-migrations/063_deposit_method.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase-migrations/063_deposit_method.sql`:

```sql
-- ============================================================
-- 063: Booking deposit_method
-- Marks how a booking's deposit is intended to be paid:
--   'card' (default) — client pays the deposit online via Stripe
--   'cash'           — client/engineer intends a cash deposit;
--                      the slot is held only once the engineer
--                      records the cash (status flips to confirmed).
-- Additive + defaulted so every existing row becomes 'card'.
-- Nothing reads it as required; no backfill needed.
-- ============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS deposit_method TEXT NOT NULL DEFAULT 'card';
```

- [ ] **Step 2: Apply the migration to the database**

This column MUST exist in the database before any code that writes it is deployed. Apply it using the project's normal mechanism — the Supabase SQL editor, or the Supabase MCP `apply_migration` tool with name `063_deposit_method` and the SQL above.

**Pause point:** Applying to the production database is a live change. Confirm with the owner before applying to prod. Applying an additive, defaulted column is low-risk (no rewrite of existing data semantics), but get the go-ahead.

- [ ] **Step 3: Verify the column exists**

Run a read query (Supabase SQL editor or MCP `execute_sql`):
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings' AND column_name = 'deposit_method';
```
Expected: one row — `deposit_method | text | 'card'::text | NO`.

---

## Task 2: Invite creation — set `deposit_method`, cash → `pending_deposit`

**Files:**
- Modify: `app/api/booking/invite/route.ts`

This changes the cash branch so an upfront cash invite no longer auto-confirms: it becomes `pending_deposit` with a real 50% deposit target and `deposit_method='cash'`. The online branch gets `deposit_method='card'`.

- [ ] **Step 1: Import PRICING**

The file currently imports `SITE_URL, ENGINEERS` from constants. Confirm `PRICING` is available; update the import line near the top:

```ts
import { SITE_URL, ENGINEERS, PRICING } from '@/lib/constants';
```

- [ ] **Step 2: Rewrite the cash branch**

Find the `if (paymentMethod === 'cash') {` block (currently inserts `status: 'confirmed'`, `deposit_amount: 0`, `remainder_amount: totalAmount`, `actual_deposit_paid: 0`). Replace the `.insert({ ... })` object's money/status fields so it reads:

```ts
    if (paymentMethod === 'cash') {
      // Cash invite — created as pending_deposit (NOT auto-confirmed). The
      // slot is NOT held until the engineer records the cash (which flips it
      // to 'confirmed' via /api/booking/record-payment). Deposit target is
      // 50%, mirroring the online flow; the engineer can record any amount.
      const cashDeposit = depositAmount && depositAmount > 0
        ? depositAmount
        : Math.round(totalAmount * PRICING.depositPercent / 100);
      const { data: booking, error } = await serviceClient
        .from('bookings')
        .insert({
          customer_name: clientName,
          customer_email: clientEmail,
          artist_name: artistName || null,
          start_time: `${date}T${startTime}:00+00:00`,
          end_time: `${date}T${endTime}:00+00:00`,
          duration,
          room,
          engineer_name: engineerName,
          created_by_email: user.email,
          total_amount: totalAmount,
          deposit_amount: cashDeposit,
          remainder_amount: totalAmount - cashDeposit,
          actual_deposit_paid: 0,
          deposit_method: 'cash',
          media_addons: mediaAddons || null,
          status: 'pending_deposit',
          admin_notes: `Cash invite created by ${user.email}. Token: ${inviteToken}. ${customPrice ? `Custom price: $${(customPrice / 100).toFixed(2)}. ` : ''}${notes || ''}`,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Failed to create cash booking:', JSON.stringify(error));
        return NextResponse.json({ error: `Failed to create booking: ${error.message}` }, { status: 500 });
      }
```

Leave the rest of the cash branch (media_sales loop, invite URL, email send, return) as-is — EXCEPT the email `deposit` value: change `deposit: 0,` to `deposit: cashDeposit,` in the `sendSessionInvite(...)` call inside this branch so the client sees the real deposit due.

- [ ] **Step 3: Add `deposit_method: 'card'` to the online branch**

In the online-payment `.insert({ ... })` (the one with `status: 'pending_deposit'`), add the field right after `remainder_amount: totalAmount - depositAmount,`:

```ts
        remainder_amount: totalAmount - depositAmount,
        deposit_method: 'card',
        media_addons: mediaAddons || null,
        status: 'pending_deposit',
```

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit` → expect 0 errors.
Run: `npx eslint "app/api/booking/invite/route.ts"` → expect 0 errors.

---

## Task 3: Email helper — `sendCashChosenAlert`

**Files:**
- Modify: `lib/email.ts`

- [ ] **Step 1: Add the helper**

In `lib/email.ts`, directly after the `sendRescheduleRequestAlert` function (ends ~line 346), add a new exported function. It mirrors that function's style (`wrap`, `h1`, `p`, `detailTable`, `detail`, `btn`, `FROM`, `SITE_URL`, `ROOM_LABELS`, `Room` are already imported/used in this file):

```ts
export async function sendCashChosenAlert(to: string, details: {
  customerName: string; artistName?: string | null;
  date: string; startTime: string; room: string;
  depositAmount: number; engineerName: string | null;
}) {
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    const depositStr = `$${(details.depositAmount / 100).toFixed(2)}`;
    await resend.emails.send({
      from: FROM, to: [to],
      subject: `Cash Deposit Chosen — ${details.customerName}`,
      html: wrap(`
        ${h1('Client Chose to Pay Cash')}
        ${p(`${details.customerName} chose to pay their deposit in cash for the session below. Their time is NOT held yet — collect the ${depositStr} deposit and record it to lock the slot.`)}
        ${detailTable(`
          ${detail('Client', details.customerName)}
          ${details.artistName ? detail('Artist Name', details.artistName) : ''}
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
          ${detail('Studio', roomLabel)}
          ${detail('Deposit Due (cash)', depositStr)}
          ${details.engineerName ? detail('Engineer', details.engineerName) : ''}
        `)}
        ${p('Record the cash from your sessions list to confirm the booking.')}
        ${btn('Open My Sessions', `${SITE_URL}/engineer`)}
      `),
    });
  } catch (e) { console.error('Email error (cash chosen):', e); }
}
```

- [ ] **Step 2: Verify the helper's link target**

Confirm `/engineer` is the engineer sessions route (the dashboard hosting `EngineerSessions`). If the engineer view lives at a different path (e.g. `/dashboard`), use that path instead. Grep: `npx eslint` not needed yet; just confirm the route exists with `Glob` on `app/engineer/**` or `app/**/EngineerSessions`. If unsure, default to `${SITE_URL}/engineer`.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npx eslint "lib/email.ts"` → 0 errors.

---

## Task 4: New route — client elects cash

**Files:**
- Create: `app/api/booking/invite/choose-cash/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/booking/invite/choose-cash/route.ts`. This mirrors `invite/pay/route.ts`'s auth + token validation + account-linking, but instead of creating a Stripe session it sets `deposit_method='cash'` and emails the engineer. Status stays `pending_deposit` (no hold).

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { ENGINEERS, SUPER_ADMINS, type Room } from '@/lib/constants';
import { sendCashChosenAlert } from '@/lib/email';

// Client elects to pay their invite deposit in CASH. This does NOT charge or
// hold the slot — it records the intent (deposit_method='cash'), keeps the
// booking 'pending_deposit', and alerts the engineer to collect + record cash.
export async function POST(request: NextRequest) {
  try {
    const { bookingId, token } = await request.json();
    if (!bookingId || !token) {
      return NextResponse.json({ error: 'Missing bookingId or token' }, { status: 400 });
    }

    // Require an authenticated account (same gate as the card path)
    const authClient = await createClient();
    const { data: { user: authUser } } = await authClient.auth.getUser();
    if (!authUser) {
      return NextResponse.json({ error: 'You must be signed in to confirm your session.' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Validate token (matches invite/pay)
    if (!booking.admin_notes || !booking.admin_notes.includes(`Token: ${token}`)) {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 403 });
    }

    if (booking.status === 'confirmed') {
      return NextResponse.json({ alreadyConfirmed: true, message: 'Session already confirmed' });
    }
    if (booking.status !== 'pending' && booking.status !== 'pending_deposit') {
      return NextResponse.json({ error: 'This booking has been cancelled. Please contact the studio for a new invite.' }, { status: 400 });
    }

    // Link the booking to the authenticated account (mirrors invite/pay)
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', authUser.id)
      .single();
    const realName = profile?.display_name || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Client';
    const realEmail = authUser.email || booking.customer_email;

    const { error: updateErr } = await supabase
      .from('bookings')
      .update({
        customer_name: realName,
        customer_email: realEmail,
        deposit_method: 'cash',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateErr) {
      console.error('choose-cash update failed:', updateErr);
      return NextResponse.json({ error: 'Could not update booking' }, { status: 500 });
    }

    // Alert the engineer (fall back to super admins if unassigned)
    const engineerCfg = ENGINEERS.find(
      (e) => e.name === booking.engineer_name || e.displayName === booking.engineer_name,
    );
    const alertTo = engineerCfg?.email || SUPER_ADMINS[0];
    const startDate = new Date(booking.start_time);
    const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

    await sendCashChosenAlert(alertTo, {
      customerName: realName,
      artistName: booking.artist_name,
      date: dateStr,
      startTime: timeStr,
      room: (booking.room as Room) || '',
      depositAmount: booking.deposit_amount || 0,
      engineerName: booking.engineer_name,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('choose-cash error:', err);
    return NextResponse.json({ error: 'Failed to choose cash' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npx eslint "app/api/booking/invite/choose-cash/route.ts"` → 0 errors.

---

## Task 5: Invite page — "Pay Cash" button + cash-pending view

**Files:**
- Modify: `app/api/booking/invite/lookup/route.ts`
- Modify: `app/book/invite/[token]/page.tsx`

- [ ] **Step 1: Add `deposit_method` to the lookup select**

In `app/api/booking/invite/lookup/route.ts`, the select on line 18 ends with `... media_addons`. Add `deposit_method`:

```ts
    .select('id, customer_name, customer_email, artist_name, start_time, duration, room, total_amount, deposit_amount, remainder_amount, status, engineer_name, admin_notes, media_addons, deposit_method')
```

- [ ] **Step 2: Add `deposit_method` to the page's `BookingData` type**

In `app/book/invite/[token]/page.tsx`, add to the `BookingData` type (after `media_addons`):

```ts
  media_addons: Array<{ type: string; description: string; amount: number }> | null;
  deposit_method: string;
};
```

- [ ] **Step 3: Add a cash-choose handler + state**

After the `handlePayDeposit` function, add a new state declaration (near the other `useState`s, e.g. after `const [paying, setPaying] = useState(false);`):

```ts
  const [choosingCash, setChoosingCash] = useState(false);
  const [cashChosen, setCashChosen] = useState(false);
```

Then add the handler after `handlePayDeposit`:

```ts
  async function handleChooseCash() {
    if (!booking) return;
    setChoosingCash(true);
    try {
      const res = await fetch('/api/booking/invite/choose-cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, token }),
      });
      const data = await res.json();
      if (data.success) {
        setCashChosen(true);
      } else if (data.alreadyConfirmed) {
        setConfirmed(true);
      } else {
        alert(data.error || 'Something went wrong');
      }
    } catch {
      alert('Something went wrong');
    } finally {
      setChoosingCash(false);
    }
  }
```

- [ ] **Step 4: Render the cash-pending state**

The page already computes `isCash` (currently `booking.deposit_amount === 0`). Replace that line (≈ line 179) with a `deposit_method`-aware version:

```ts
  const isCash = booking.deposit_method === 'cash';
```

Then, immediately BEFORE the final `// Pending online payment — show details + pay button` return block, add a cash-pending branch. It shows when the client has chosen cash (locally or persisted) and isn't yet confirmed:

```tsx
  // Cash chosen — slot is NOT held until the engineer records the cash.
  if ((cashChosen || isCash) && !confirmed) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-lg w-full">
          <div className="border-2 border-black p-8 text-center">
            <DollarSign className="w-12 h-12 text-accent mx-auto mb-4" />
            <h1 className="text-heading-sm mb-2">PAY CASH AT THE STUDIO</h1>
            <p className="font-mono text-sm text-black/60 mb-6">
              Pay your {formatCents(booking.deposit_amount)} deposit in cash to your engineer.
              Heads up: your time isn&apos;t locked in until we receive it, so bring it as soon as you can.
            </p>
            <div className="text-left border-t border-black/10 pt-4 space-y-3 font-mono text-sm">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-black/40 shrink-0" />
                <span>{dateStr}</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-black/40 shrink-0" />
                <span>{timeStr} &mdash; {formatDuration(booking.duration)}</span>
              </div>
              <div className="flex items-center gap-3">
                <Music className="w-4 h-4 text-black/40 shrink-0" />
                <span>{roomLabel}</span>
              </div>
              <div className="flex items-center gap-3">
                <DollarSign className="w-4 h-4 text-black/40 shrink-0" />
                <span>Deposit due in cash: {formatCents(booking.deposit_amount)}</span>
              </div>
            </div>
            <a href="/dashboard" className="inline-block mt-6 font-mono text-sm text-accent hover:underline">
              View your dashboard &rarr;
            </a>
          </div>
        </div>
      </div>
    );
  }
```

- [ ] **Step 5: Add the "Pay Cash" button to the pay block**

In the final return, inside the `authedUser` (signed-in) `<>...</>` branch, directly after the existing `PAY ... DEPOSIT` button, add a secondary button:

```tsx
              <button
                onClick={handleChooseCash}
                disabled={paying || choosingCash}
                className="w-full mt-2 border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider py-3 hover:bg-black hover:text-white transition-colors disabled:opacity-50"
              >
                {choosingCash ? 'SAVING...' : 'PAY CASH AT STUDIO INSTEAD'}
              </button>
```

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npx eslint "app/api/booking/invite/lookup/route.ts" "app/book/invite/[token]/page.tsx"` → 0 errors.

---

## Task 6: Record cash → confirm + slot guard + deposit money-math

**Files:**
- Modify: `app/api/booking/record-payment/route.ts`

This is the critical money task. When the booking is `pending_deposit`, recording cash must: (a) block if the slot was taken, (b) otherwise confirm + set the deposit correctly. When the booking is already `confirmed`, behavior is unchanged.

- [ ] **Step 1: Widen the booking select**

Change the select (≈ line 20-24) to fetch the fields the confirm path needs:

```ts
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, remainder_amount, total_amount, deposit_amount, engineer_name, customer_name, start_time, duration')
    .eq('id', bookingId)
    .single();
```

- [ ] **Step 2: Insert the pending-deposit confirm branch**

Immediately AFTER the ownership gate block (the `if (!ownership.isAdmin && !ownership.ownsBooking)` return, ≈ line 39) and BEFORE `const amountCents = Math.round(amount * 100);`, the `amountCents` line stays. Then insert this branch BEFORE the existing `let newTotal = ...` block:

```ts
  const amountCents = Math.round(amount * 100);

  // ── Cash deposit on a pending invite → confirm + hold the slot ──
  // Distinct from a remainder paydown on an already-confirmed booking
  // (handled by the unchanged logic below). Per spec §7: recording cash A
  // sets actual_deposit_paid = min(A, deposit), remainder = max(0, total - A),
  // and flips status to 'confirmed'. Guarded by a slot-conflict check that
  // BLOCKS (never double-books) if the open slot was taken in the meantime.
  if (booking.status === 'pending_deposit') {
    // Slot conflict guard — replicates app/api/booking/create/route.ts
    // (time-overlap across confirmed+pending on the same date; room-agnostic,
    // since the studio shares space). The pending_deposit row itself is not in
    // that status set, so it can't conflict with itself; .neq is belt-and-suspenders.
    const bDate = booking.start_time.split('T')[0];
    const bt = new Date(booking.start_time);
    const startHour = bt.getUTCHours() + bt.getUTCMinutes() / 60;
    const dur = Number(booking.duration) || 1;
    const requestedSlots = Array.from({ length: Math.ceil(dur * 2) }, (_, i) => (startHour + i * 0.5) % 24);

    const { data: clashes } = await supabase
      .from('bookings')
      .select('id, start_time, duration')
      .gte('start_time', `${bDate}T00:00:00`)
      .lte('start_time', `${bDate}T23:59:59`)
      .in('status', ['confirmed', 'pending'])
      .neq('id', bookingId);

    for (const other of clashes || []) {
      const ot = new Date(other.start_time);
      const oStart = ot.getUTCHours() + ot.getUTCMinutes() / 60;
      const oSlots = Array.from({ length: Math.ceil((Number(other.duration) || 1) * 2) }, (_, i) => (oStart + i * 0.5) % 24);
      if (requestedSlots.some((s) => oSlots.includes(s))) {
        return NextResponse.json(
          { error: 'This time was booked by someone else — reschedule this cash booking to an open time first.' },
          { status: 409 },
        );
      }
    }

    const depositTarget = booking.deposit_amount || 0;
    const actualDepositPaid = Math.min(amountCents, depositTarget);
    const confirmedRemainder = Math.max(0, booking.total_amount - amountCents);

    const { error: confErr } = await supabase.from('bookings').update({
      status: 'confirmed',
      actual_deposit_paid: actualDepositPaid,
      remainder_amount: confirmedRemainder,
      updated_at: new Date().toISOString(),
    }).eq('id', bookingId);

    if (confErr) {
      console.error('[RECORD-PAYMENT] confirm-deposit update failed:', confErr);
      return NextResponse.json({ error: confErr.message }, { status: 500 });
    }

    // Audit + cash ledger (cash only) — mirrors the standard path below.
    try {
      await supabase.from('booking_audit_log').insert({
        booking_id: bookingId,
        action: 'cash_deposit_confirm',
        performed_by: user.email || 'unknown',
        details: {
          amount: amountCents, method, note: note || '',
          deposit_target: depositTarget,
          actual_deposit_paid: actualDepositPaid,
          new_remainder: confirmedRemainder,
          confirmed_from: 'pending_deposit',
        },
      });
    } catch (e) {
      console.error('[RECORD-PAYMENT] confirm-deposit audit threw:', e instanceof Error ? e.message : String(e));
    }

    if (method === 'cash' && booking.engineer_name) {
      try {
        const { createServiceClient } = await import('@/lib/supabase/server');
        const serviceClient = createServiceClient();
        await serviceClient.from('cash_ledger').insert({
          booking_id: bookingId,
          engineer_name: booking.engineer_name,
          amount: amountCents,
          client_name: booking.customer_name || 'Unknown',
          note: note || 'Cash deposit recorded (booking confirmed)',
          recorded_by: user.email || 'unknown',
          status: 'owed',
        });
      } catch (e) {
        console.error('Cash ledger error (confirm-deposit):', e);
      }
    }

    return NextResponse.json({
      success: true,
      amountRecorded: amountCents,
      newRemainder: confirmedRemainder,
      confirmed: true,
    });
  }
```

The existing `let newTotal = booking.total_amount;` ... block and everything after it stays UNCHANGED — it now only runs for non-`pending_deposit` bookings (the confirmed-remainder and add-to-total cases).

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npx eslint "app/api/booking/record-payment/route.ts"` → 0 errors.

- [ ] **Step 4: Reason-check the money math (no framework — manual trace)**

Confirm by hand against spec §7 with `T=20000, D=10000`:
- Record `A=10000` (deposit): `actual_deposit_paid = min(10000,10000)=10000`; `remainder = max(0, 20000-10000)=10000`; status confirmed. ✓
- Record `A=20000` (full): `actual_deposit_paid = min(20000,10000)=10000`; `remainder = 0`; confirmed. ✓
- Record `A=5000` (partial): `actual_deposit_paid=5000`; `remainder=15000`; confirmed. ✓ (any cash confirms, per owner's "records how much cash is received, then that locks").

---

## Task 7: "Cash pending" badges

**Files:**
- Modify: `app/api/booking/all/route.ts`
- Modify: `components/engineer/EngineerSessions.tsx`
- Modify: `components/admin/BookingManager.tsx`

- [ ] **Step 1: Add `deposit_method` to `/api/booking/all` select**

In `app/api/booking/all/route.ts`, the select on line 17 ends with `... status`. Add `deposit_method`:

```ts
    .select('id, customer_name, artist_name, start_time, end_time, duration, room, engineer_name, status, deposit_method')
```

(The admin list `app/api/admin/bookings/route.ts` already uses `select('*', ...)`, so no change there.)

- [ ] **Step 2: Add `deposit_method` to both `Booking` types**

In `components/engineer/EngineerSessions.tsx`, in the `interface Booking { ... }` (which already has `reschedule_requested?: boolean;`), add:

```ts
  reschedule_requested?: boolean;
  deposit_method?: string;
```

In `components/admin/BookingManager.tsx`, in its `interface Booking { ... }` (which has `reschedule_requested: boolean;` near `reschedule_requested_at`), add:

```ts
  reschedule_requested: boolean;
  deposit_method?: string;
```

- [ ] **Step 3: Add the badge in `EngineerSessions.tsx`**

The engineer row renders a reschedule flag like:
```tsx
          {booking.reschedule_requested && (
            <p className="font-mono text-[10px] text-red-500 font-semibold mt-0.5">
              ⚠ Reschedule Requested
            </p>
          )}
```
Directly AFTER that block, add:

```tsx
          {booking.status === 'pending_deposit' && booking.deposit_method === 'cash' && (
            <p className="font-mono text-[10px] text-amber-600 font-semibold mt-0.5">
              ⏳ Cash pending — record cash to lock the slot
            </p>
          )}
```

- [ ] **Step 4: Add the badge in `BookingManager.tsx`**

In the list row, next to the existing reschedule badge:
```tsx
                      {b.reschedule_requested && (
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-200 text-amber-800 animate-pulse">
                          Reschedule Requested
                        </span>
                      )}
```
Directly AFTER it, add:

```tsx
                      {b.status === 'pending_deposit' && b.deposit_method === 'cash' && (
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-100 text-amber-700">
                          Cash Pending
                        </span>
                      )}
```

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npx eslint "app/api/booking/all/route.ts" "components/engineer/EngineerSessions.tsx" "components/admin/BookingManager.tsx"` → 0 errors.

---

## Task 8: Final verification

**Files:** none changed (verification only).

- [ ] **Step 1: Production build**

Run: `npm run build` → expect exit 0, no type/lint errors.

- [ ] **Step 2: Manual smoke test (dev server, appropriate logins)**

1. **Upfront cash invite:** engineer creates a cash invite → booking is `pending_deposit`; the calendar/availability shows the slot **OPEN**; engineer list shows "Cash pending".
2. **Client picks cash on a Stripe invite:** open a `pending_deposit` (card) invite → see "Pay Deposit (Card)" + "Pay Cash at Studio Instead" → click cash → see the cash-pending screen; engineer receives the email; slot still open; engineer list shows "Cash pending".
3. **Record cash → lock:** engineer clicks "Record Cash" on that booking, records the deposit → booking becomes `confirmed`; slot now **held**; `cash_ledger` row exists; `actual_deposit_paid` + `remainder_amount` match §7.
4. **Conflict block:** with a cash booking still pending, book + confirm another session over the same time, then try to record the cash → **blocked** with the reschedule message; no double-book; booking stays `pending_deposit`.
5. **Card regression:** a normal Stripe invite still pays + confirms exactly as before (webhook path untouched).
6. **Remainder regression:** recording cash against an already-`confirmed` booking still reduces the remainder as before (no status/deposit side effects).

- [ ] **Step 3: Scope check**

Run: `git status --short` and `git diff --stat`.
Expected modified/created (this feature): `supabase-migrations/063_deposit_method.sql`, `app/api/booking/invite/route.ts`, `app/api/booking/invite/choose-cash/route.ts`, `lib/email.ts`, `app/api/booking/invite/lookup/route.ts`, `app/book/invite/[token]/page.tsx`, `app/api/booking/record-payment/route.ts`, `app/api/booking/all/route.ts`, `components/engineer/EngineerSessions.tsx`, `components/admin/BookingManager.tsx`, plus the `docs/` files. PLUS the pre-existing uncommitted Command Center files (`components/admin/AdminOverview.tsx`, `components/admin/AdminDashboard.tsx`, `app/api/admin/attention/`, `components/admin/attention/`) — leave those as-is. NO edits to `availability*`, `webhook`, or `invite/pay`.

- [ ] **Step 4: Done — present diff to owner. Do not commit.**

---

## Self-Review

Performed against the spec:

- **Spec coverage:** §3 decision 1 (cash holds only when recorded) → Tasks 2 (cash→pending_deposit) + 6 (record→confirm); decision 2 (email+badge) → Tasks 3/4 (email) + 7 (badge); decision 3 (slot-taken blocks) → Task 6 Step 2 guard; decision 4 (`deposit_method` column) → Task 1; decision 5 (no toggle) → nothing built. §4 status model → Tasks 2/6. §5 migration → Task 1. §6.1 client cash → Tasks 4/5; §6.2 upfront cash aligns → Task 2; §6.3 notify → Tasks 3/7; §6.4 record→confirm+guard → Task 6. §7 money-math → Task 6 (exact formula + trace). §8 safety (untouched files) → Conventions + Task 8 Step 3. §9 verification → Task 8. All covered.
- **Placeholder scan:** none — every code step has complete code; every command is exact.
- **Type consistency:** `deposit_method` is the column name everywhere (migration, selects, types, conditionals); `sendCashChosenAlert(to, details)` signature matches its only caller (Task 4); `choose-cash` request body `{ bookingId, token }` matches the page's fetch (Task 5 Step 3); `record-payment` confirm branch reads only fields added to the select in Step 1.
- **One verify-in-place note:** Task 3 Step 2 confirms the engineer route path for the email button (`/engineer` default) — a path check, not a placeholder.
