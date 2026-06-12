# Sitewide Studio-Local Time Display — Design Spec

**Date:** 2026-06-01
**Status:** Approved approach (owner chose "full audited sweep") — design for review

## 1. Goal

**Every time displayed anywhere on the site shows the studio's local (Fort Wayne / Eastern) time, correctly and consistently — regardless of the viewer's own timezone.** No more session times that render 4–5 hours off, and no reliance on the viewer's browser timezone.

**Non-goal / explicitly out of scope:** changing how timestamps are *stored*. No data migration. The fix is entirely at the **display** layer. (A true-UTC storage migration is the "textbook" alternative but is high-risk on a live booking system and is deliberately not done here.)

## 2. The core problem — two storage conventions

The single fact that makes this dangerous: the database holds **two kinds of timestamps that require opposite display handling** to both show Eastern.

| Convention | How it's stored | Example columns | Correct studio-local display |
|---|---|---|---|
| **Wall-clock-as-UTC** | The Fort Wayne wall-clock time, labeled `+00:00`. A 6:00 PM session is stored `18:00:00+00:00`. | `bookings.start_time`, `bookings.end_time`, `studio_blocks.start_time`/`end_time` | Read back **as UTC** (`timeZone: 'UTC'`) → recovers `18:00` → "6:00 PM" ✓ |
| **True UTC** | The real UTC instant of an event, from DB `now()` or `new Date().toISOString()`. | `*.created_at`, `*.updated_at`, `bookings.reschedule_requested_at`, `bookings.claimed_at`, `cash_ledger.collected_at`, payouts/audit `*_at` | Convert **to Eastern** (`timeZone: 'America/Indiana/Indianapolis'`) ✓ |

Applying ONE rule everywhere is the trap:
- "Eastern everywhere" → shifts every wall-clock session time back 4–5h (breaks the operationally critical times).
- "UTC everywhere" → shows audit/created timestamps in UTC, not local.

A third failure mode: displays that pass **no `timeZone`** fall back to the *viewer's* browser zone — correct only for a viewer physically in Eastern, wrong for anyone else / SSR.

## 3. Current state (from audit)

- `timeZone: 'UTC'` — **112 occurrences across 34 files.** Overwhelmingly the correct wall-clock-recovery for booking times.
- `America/Indiana/Indianapolis` — **13 occurrences across 8 code files.** Mostly *legitimate server-side "now"/boundary logic* (booking same-day buffer, availability buffer, `getFortWayneBoundaries`, the `TIMEZONE`/`FW_TZ` constants). A few are **display bugs** (session time formatted as Eastern → shifted): confirmed in `components/admin/AdminOverview.tsx` (Recent Bookings); suspected in `lib/media-scheduling.ts` (`formatWindowLabel`) pending its column's storage classification.
- Unknown count of displays using **no `timeZone`** (browser-default) — these must be found and pinned to studio-local too.

## 4. The fix — a shared studio-time helper

Create `lib/studio-time.ts` as the single source of truth. Two clearly-named families so each call site declares the *storage type* of the value it's formatting:

```ts
import { TIMEZONE } from './constants'; // 'America/Indiana/Indianapolis'

// ── Wall-clock-as-UTC values (booking start_time/end_time, studio_blocks) ──
// Stored as Fort Wayne wall-clock labeled UTC; read back as UTC to recover it.
export function fmtSessionDateTime(iso: string | null | undefined): string
export function fmtSessionDate(iso: string | null | undefined): string
export function fmtSessionTime(iso: string | null | undefined): string

// ── True-UTC instants (created_at, *_at audit/event timestamps) ──
// Real UTC moments; convert to Fort Wayne for studio-local display.
export function fmtStampDateTime(iso: string | null | undefined): string
export function fmtStampDate(iso: string | null | undefined): string
export function fmtStampTime(iso: string | null | undefined): string
```

- `fmtSession*` use `timeZone: 'UTC'` internally; `fmtStamp*` use `timeZone: TIMEZONE`.
- All return `''` for null/empty (no "Invalid Date").
- A short doc comment on each names example columns so call-site authors pick correctly.
- The function NAME encodes the decision, so a reviewer can sanity-check a call site without re-deriving the storage convention each time.

This converts 100+ scattered, individually-classified `toLocaleString(..., {timeZone})` calls into helper calls whose name states intent — the classification happens **once per call site, reviewably**, not re-derived ad hoc.

## 5. Column reference table (authoritative classification)

The plan will finalize this by grepping schema + write sites; initial classification:

**Wall-clock-as-UTC → `fmtSession*`:**
- `bookings.start_time`, `bookings.end_time`
- `studio_blocks.start_time`, `studio_blocks.end_time`
- media-session start/end (`media_*` scheduling) — **confirm** against how those rows are written before classifying.
- `events.starts_at` / `ends_at` — **confirm** (how AdminEvents writes them: `new Date(form.starts_at).toISOString()` from a `datetime-local` input → this is TRUE UTC-ish but represents a local intent; needs explicit classification in the plan).

**True-UTC → `fmtStamp*`:**
- every `created_at`, `updated_at`
- `bookings.reschedule_requested_at`, `bookings.claimed_at`, `bookings.priority_expires_at`, `bookings.reschedule_deadline`
- `cash_ledger.collected_at`, deposits/payouts `*_at`, `booking_audit_log` timestamps

**Ambiguous (must be resolved in the plan before any fix):** `events.*`, media-session times. These get a dedicated investigation task; no fix until classified with evidence.

## 6. Server-side logic — leave untouched

The `America/Indiana` uses that compute *"what is today/now in Fort Wayne"* server-side (booking same-day buffer in `create`/`availability`, `getFortWayneBoundaries`, `CreateInvite` same-day check, the `TIMEZONE`/`FW_TZ` constants) are **correct and out of scope.** They are not displays. The plan must explicitly mark each as "keep" so the sweep doesn't touch them.

## 7. Phasing (how the sweep stays safe)

Do NOT change all sites at once. Phased, each phase verified before the next:

1. **Helper + tests:** add `lib/studio-time.ts`; a tiny dev script asserts `fmtSessionTime('2026-06-01T18:00:00+00:00') === '6:00 PM'` and `fmtStamp*` converts a known UTC instant to the right Eastern clock time. Lock the helper's correctness first.
2. **Finalize the column table:** grep every time-display site, classify each by source column against §5, resolve the ambiguous ones with evidence. Output: a per-site list (file:line → which helper).
3. **Migrate by area, verify each area** (booking displays → engineer views → admin → dashboards → emails). After each area: `tsc`, `build`, and a spot-check that a known session still reads at its real time.
4. **Final pass:** grep for any remaining raw `toLocaleString`/`toLocaleTimeString`/`Date` displays with no helper; pin or justify each.

## 8. Verification

- Helper correctness asserted by the dev script (phase 1).
- After each area: `npx tsc --noEmit` = 0, `npm run build` = 0.
- **Regression spot-check:** pick one known booking (with a known real session time) and confirm it renders identically before/after on each migrated screen — the "no session time shifted" guarantee.
- Final grep proving no un-helpered time displays remain.
- Emails included (they format times too — `lib/email.ts`).

## 9. Command Center entanglement

The confirmed `AdminOverview` Recent Bookings bug lives in the **currently-uncommitted Command Center** file. To avoid tangling two efforts in one file, **commit the Command Center first** (after the owner smoke-tests it); then this sweep fixes `AdminOverview` on a clean base. The plan assumes CC is committed before the admin-area phase.

## 10. Risk summary

- **Biggest risk:** misclassifying a column → flips a time on the live site. Mitigated by the §5 table being resolved with evidence before any edit, the helper names encoding intent, and per-area regression spot-checks.
- **No data migration** → existing rows untouched → existing correct displays (the 112 UTC-read booking times) keep working; we only add a helper and re-point call sites.
- Server-now logic explicitly fenced off (§6).
