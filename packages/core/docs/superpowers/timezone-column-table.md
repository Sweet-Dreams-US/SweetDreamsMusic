# Timezone Column Classification (authoritative)

Produced by Task 2 of `docs/superpowers/plans/2026-06-01-timezone-studio-local.md`.
Every time-display fix looks up its source column here and uses the matching
`lib/studio-time.ts` helper. **A wrong row here shifts a real session time — resolve `NEEDS-EVIDENCE` before touching those displays.**

## Helper families
- `fmtSession*` → wall-clock-as-UTC columns. Rendered `timeZone:'UTC'` to recover the stored Fort Wayne wall clock. (Do NOT convert.)
- `fmtStamp*` → true-UTC instants. Rendered `timeZone:'America/Indiana/Indianapolis'` to convert to Eastern.

## Column table

| Column | Storage | Helper | Evidence |
|---|---|---|---|
| `bookings.start_time` | wall-clock-as-UTC | **fmtSession*** | `app/api/booking/create/route.ts` writes `${date}T${startTime}:00+00:00`; `invite/route.ts` same |
| `bookings.end_time` | wall-clock-as-UTC | **fmtSession*** | `app/api/booking/invite/route.ts` writes `${date}T${endTime}:00+00:00` |
| `studio_blocks.start_time` / `end_time` | wall-clock-as-UTC | **fmtSession*** | `components/admin/StudioBlocks.tsx` displays with `timeZone:'UTC'` (existing correct convention) |
| media-credit `bookings` rows | wall-clock-as-UTC | **fmtSession*** | `app/api/media/credits/book/route.ts` builds from `date` + `start_time` HH:MM into `bookings` |
| `*.created_at`, `*.updated_at` | true UTC | **fmtStamp*** | DB `default now()` / `new Date().toISOString()` |
| `bookings.reschedule_requested_at` | true UTC | **fmtStamp*** | `app/api/booking/reschedule-request/route.ts` → `new Date().toISOString()` |
| `bookings.claimed_at`, `priority_expires_at`, `reschedule_deadline` | true UTC | **fmtStamp*** | set via `new Date().toISOString()` / webhook computed instants |
| `cash_ledger.collected_at`, deposit/payout `*_at` | true UTC | **fmtStamp*** | recorded via `new Date().toISOString()` |
| `events.starts_at` / `ends_at` | **true UTC** | **fmtStamp*** | `components/admin/AdminEvents.tsx:140` writes `new Date(form.starts_at).toISOString()` from a zone-naive `datetime-local` input → stores the true-UTC instant of the admin's local entry |
| `media_session_bookings.starts_at` / `ends_at` | **true UTC** | **fmtStamp*** | `components/media/MediaSessionScheduler.tsx:81-82` builds `const startsAtIso = \`${date}T${startTime}:00\`` (zone-naive), wraps in `new Date(startsAtIso)` (browser local zone), then POSTs `startsAtDate.toISOString()` — a true-UTC instant. Pattern identical to `events.starts_at`. |

## KEEP — server-side "now"/boundary logic (NOT displays, do not change)
- `app/api/booking/create/route.ts` — same-day buffer (`toLocaleDateString('en-CA', {timeZone:'America/Indiana/Indianapolis'})` + 3hr buffer)
- `app/api/booking/availability/route.ts` — same-day buffer
- `app/api/admin/overview/route.ts` — `getFortWayneBoundaries()`
- `app/api/admin/attention/route.ts` — `fortWayneNow()`
- `components/engineer/CreateInvite.tsx` — same-day surcharge check
- `lib/constants.ts` `TIMEZONE`, `lib/booking-completion.ts` `FW_TZ` — constant definitions

## Migration areas (Tasks 3–7)
1. **Booking + scheduling:** `lib/media-scheduling.ts`*, `components/admin/StudioBlocks.tsx`, `app/book/**`, `app/dashboard/prep/[bookingId]/page.tsx` (*resolve media first)
2. **Engineer views:** `components/engineer/EngineerSessions.tsx`, `EngineerAvailability.tsx`, `EngineerCRM.tsx`, `EngineerAccounting.tsx`, `EngineerMediaSessions.tsx`*
3. **Admin views:** `components/admin/BookingManager.tsx`, `ClientCRM.tsx`, `Accounting.tsx`*, `CashCorrectionsLog.tsx`, `AdminEvents.tsx`, `MediaOrders.tsx`*, `AdminOverview.tsx` (ships with held CC)
4. **Client dashboards + public:** `app/dashboard/**`, `app/u/[slug]/page.tsx`, `app/events/**`, `components/hub/*`, `app/beats/[id]/page.tsx`
5. **Emails + cron:** `lib/email.ts`, `app/api/cron/*` (display strings in notifications)

## Separate (not a toLocale display, flag for owner)
- `AdminEvents.tsx:100` edit form loads `event.starts_at.slice(0,16)` into a `datetime-local` input — shows the raw UTC wall-clock in the editor, not Eastern. This is a form-value concern (not a `toLocale*` display) and is outside the helper sweep; note for a follow-up.
