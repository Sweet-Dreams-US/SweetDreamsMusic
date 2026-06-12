# Sitewide Studio-Local Time Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every time displayed on the site renders in the studio's local (Fort Wayne / Eastern) time, correctly and consistently, with no data migration.

**Architecture:** Add one shared helper module (`lib/studio-time.ts`) exposing two clearly-named families — `fmtSession*` for wall-clock-as-UTC booking times (rendered with `timeZone:'UTC'` to recover the stored local clock) and `fmtStamp*` for true-UTC instants (rendered with `timeZone: TIMEZONE` to convert to Eastern). Audit every time-display call site, classify it against an authoritative column table, and re-point it to the correct helper. Phased + verified per area. Server-side "now/boundary" logic is untouched.

**Tech Stack:** Next.js 16, TypeScript, `Intl`/`toLocaleString`, `lib/constants.TIMEZONE = 'America/Indiana/Indianapolis'`.

**Design spec:** `docs/superpowers/specs/2026-06-01-timezone-studio-local-design.md`

---

## Conventions & Notes

- **No test framework** in this repo. Verification = `npx tsc --noEmit` (0 errors), `npx eslint <files>` (0 errors), `npm run build` (exit 0), plus a one-off correctness script for the helper, plus per-area regression spot-checks. ESLint forbids `@typescript-eslint/no-explicit-any`.
- **Commits held** — owner reviews the full diff. Skip commit steps; leave changes uncommitted.
- **Do NOT touch server-side Fort-Wayne "now"/boundary logic:** `app/api/booking/create/route.ts` (same-day buffer), `app/api/booking/availability/route.ts` (same-day buffer), `app/api/admin/overview/route.ts` `getFortWayneBoundaries()`, `app/api/admin/attention/route.ts` `fortWayneNow()`, `components/engineer/CreateInvite.tsx` (same-day check), and the `TIMEZONE`/`FW_TZ` constant definitions. These compute *current* Fort-Wayne date/time for comparisons — correct, not displays.
- **Command Center held:** `components/admin/AdminOverview.tsx` is uncommitted (Command Center). Its timezone fix is applied in the working tree and ships with CC. Do the admin-area phase against the working-tree version.
- **Live booking system:** a misclassified column shifts a real session time. Every fix is classified against the Task 2 table with evidence, and each area is regression-spot-checked before moving on.

---

## File Structure

**Created:**
- `lib/studio-time.ts` — the shared formatter. Two families (`fmtSession*`, `fmtStamp*`), each forcing the correct `timeZone`, accepting optional `Intl.DateTimeFormatOptions` overrides for format variety, returning `''` for null/invalid.
- `scripts/check-studio-time.ts` — a runnable correctness assertion (no test framework, so a plain `tsx`/`node` script that throws on mismatch).
- `docs/superpowers/timezone-column-table.md` — the authoritative column→helper classification produced by Task 2.

**Modified (by area, Tasks 3–7):** every component/route/lib that formats a timestamp for display. The Task 2 audit produces the exact list; the areas are: booking displays, engineer views, admin views, client dashboards + public pages, and emails (`lib/email.ts`).

---

## Task 1: The shared helper + correctness script

**Files:**
- Create: `lib/studio-time.ts`
- Create: `scripts/check-studio-time.ts`

- [ ] **Step 1: Create `lib/studio-time.ts`**

```ts
// lib/studio-time.ts
//
// Single source of truth for displaying times in the studio's local
// (Fort Wayne / Eastern) zone. Two families because the DB holds two
// timestamp conventions that need OPPOSITE handling to both show Eastern:
//
//   fmtSession*  — for WALL-CLOCK-AS-UTC columns (bookings.start_time/end_time,
//                  studio_blocks.start_time/end_time). Stored as the Fort Wayne
//                  wall clock labeled +00:00, so we read them back AS UTC to
//                  recover the intended local time. Do NOT convert.
//
//   fmtStamp*    — for TRUE-UTC instants (created_at, updated_at, *_at audit/
//                  event timestamps). Real UTC moments, so we CONVERT to
//                  Fort Wayne for studio-local display.
//
// See docs/superpowers/timezone-column-table.md for the column classification.
import { TIMEZONE } from '@/lib/constants';

function build(
  iso: string | null | undefined,
  base: Intl.DateTimeFormatOptions,
  opts: Intl.DateTimeFormatOptions | undefined,
  tz: string,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // timeZone is forced last so callers can tweak format but never the zone.
  return d.toLocaleString('en-US', { ...base, ...opts, timeZone: tz });
}

// ── Wall-clock-as-UTC (booking times) → read as UTC ──
export function fmtSessionTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { hour: 'numeric', minute: '2-digit' }, opts, 'UTC');
}
export function fmtSessionDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', year: 'numeric' }, opts, 'UTC');
}
export function fmtSessionDateTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts, 'UTC');
}

// ── True-UTC instants (created_at, *_at) → convert to Eastern ──
export function fmtStampTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { hour: 'numeric', minute: '2-digit' }, opts, TIMEZONE);
}
export function fmtStampDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', year: 'numeric' }, opts, TIMEZONE);
}
export function fmtStampDateTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts, TIMEZONE);
}
```

- [ ] **Step 2: Create `scripts/check-studio-time.ts`**

```ts
// scripts/check-studio-time.ts — run with: npx tsx scripts/check-studio-time.ts
// Asserts the two families behave correctly. Throws (non-zero exit) on mismatch.
import {
  fmtSessionTime, fmtSessionDate, fmtStampTime,
} from '../lib/studio-time';

function assertEq(label: string, got: string, want: string) {
  if (got !== want) {
    console.error(`FAIL ${label}: got "${got}", want "${want}"`);
    process.exit(1);
  }
  console.log(`ok   ${label}: "${got}"`);
}

// Wall-clock-as-UTC: a 6:00 PM session stored as 18:00Z must read back as 6:00 PM.
assertEq('session 18:00Z -> 6:00 PM', fmtSessionTime('2026-06-01T18:00:00+00:00'), '6:00 PM');
assertEq('session midnight 00:30Z -> 12:30 AM', fmtSessionTime('2026-06-01T00:30:00+00:00'), '12:30 AM');
assertEq('session date', fmtSessionDate('2026-06-01T18:00:00+00:00'), 'Jun 1, 2026');

// True-UTC instant: 22:00Z in summer (EDT, UTC-4) is 6:00 PM Eastern.
assertEq('stamp 22:00Z -> 6:00 PM EDT', fmtStampTime('2026-07-01T22:00:00Z'), '6:00 PM');
// Winter (EST, UTC-5): 23:00Z is 6:00 PM Eastern.
assertEq('stamp 23:00Z -> 6:00 PM EST', fmtStampTime('2026-01-01T23:00:00Z'), '6:00 PM');

// Null/invalid -> empty string.
assertEq('null -> empty', fmtSessionTime(null), '');
assertEq('garbage -> empty', fmtStampTime('not-a-date'), '');

console.log('\nAll studio-time assertions passed.');
```

- [ ] **Step 3: Verify the helper**

Run: `npx tsx scripts/check-studio-time.ts`
Expected: every line `ok`, final "All studio-time assertions passed.", exit 0. If `tsx` is unavailable, run `npx ts-node scripts/check-studio-time.ts` or compile with `npx tsc scripts/check-studio-time.ts --outDir /tmp/st --module commonjs --moduleResolution node --esModuleInterop && node /tmp/st/scripts/check-studio-time.js`.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npx eslint "lib/studio-time.ts"` → 0 errors.

---

## Task 2: Authoritative column classification table

**Files:**
- Create: `docs/superpowers/timezone-column-table.md`

This is the audit. It produces the lookup that every later task uses. No display is changed in this task.

- [ ] **Step 1: Enumerate every time-display call site**

Run and save the output:
```bash
grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString\|toLocaleString\|Intl.DateTimeFormat\|timeZone:" app components lib --include=*.ts --include=*.tsx | grep -v node_modules
```
Each hit is a candidate site. (Server-now logic from the Conventions list is excluded — mark it "KEEP".)

- [ ] **Step 2: Resolve the ambiguous columns WITH EVIDENCE**

For each ambiguous column, read the WRITE site to determine storage, and record the evidence:

- **`events.starts_at` / `events.ends_at`:** Read `components/admin/AdminEvents.tsx` save handler (the `starts_at: new Date(form.starts_at).toISOString()` line) and the `datetime-local` input binding (`event.starts_at.slice(0, 16)`). A `datetime-local` value is zone-naive; `new Date(...).toISOString()` interprets it in the *browser's* zone and stores the true-UTC instant. Therefore `events.*` are **TRUE UTC → `fmtStamp*`**. Confirm the display sites (`app/events/page.tsx`, `app/events/[slug]/page.tsx`, `lib/events.ts`, `components/admin/AdminEvents.tsx`) and `app/api/admin/events/route.ts` agree. Record the verdict + the exact write-site line as evidence.
- **Media-session times** (`lib/media-scheduling.ts` `formatWindowLabel`, and the media booking tables): find the INSERT that writes the media session start/end (grep `media` routes under `app/api/` for the insert with a start/end column). Determine whether it writes `${date}T${time}:00+00:00` (wall-clock-as-UTC → `fmtSession*`) or `new Date(...).toISOString()` from a real instant (true-UTC → `fmtStamp*`). Record verdict + evidence line.

- [ ] **Step 3: Write `docs/superpowers/timezone-column-table.md`**

A table with columns: `Column | Storage convention | Helper family | Evidence (file:line)`. Seed it from the spec §5 plus the Task 2 Step 2 resolutions:

```markdown
| Column | Storage | Helper | Evidence |
|---|---|---|---|
| bookings.start_time | wall-clock-as-UTC | fmtSession* | app/api/booking/create/route.ts (`${date}T${startTime}:00+00:00`) |
| bookings.end_time | wall-clock-as-UTC | fmtSession* | app/api/booking/invite/route.ts (`${date}T${endTime}:00+00:00`) |
| studio_blocks.start_time/end_time | wall-clock-as-UTC | fmtSession* | components/admin/StudioBlocks.tsx (timeZone:'UTC') |
| *.created_at / updated_at | true UTC | fmtStamp* | DB default now() / new Date().toISOString() |
| bookings.reschedule_requested_at | true UTC | fmtStamp* | app/api/booking/reschedule-request/route.ts (new Date().toISOString()) |
| cash_ledger.collected_at | true UTC | fmtStamp* | record-payment / cash-deposits routes |
| events.starts_at / ends_at | <verdict from Step 2> | <fmtSession*|fmtStamp*> | <evidence> |
| media session start/end | <verdict from Step 2> | <fmtSession*|fmtStamp*> | <evidence> |
```

- [ ] **Step 4: Build the per-site worklist**

For each site from Step 1 (excluding KEEP server-now logic), note `file:line → column it formats → target helper`. Append this list to the table doc. This worklist drives Tasks 3–7. Any site whose column can't be classified gets flagged `NEEDS-EVIDENCE` and resolved before it is touched.

---

## Tasks 3–7: Migrate by area (one task per area)

Each area task follows the SAME structure (repeated per area so they can run independently). Areas:
- **Task 3 — Booking + scheduling displays:** `lib/media-scheduling.ts`, `components/admin/StudioBlocks.tsx`, `app/book/**`, `app/api/booking/**` response-formatting only (NOT the server-now logic).
- **Task 4 — Engineer views:** `components/engineer/*.tsx` (EngineerSessions, EngineerAvailability, EngineerCRM, EngineerAccounting, EngineerMediaSessions).
- **Task 5 — Admin views:** `components/admin/*.tsx` (BookingManager, ClientCRM, Accounting, CashCorrectionsLog, AdminEvents, UserManager) + `components/admin/AdminOverview.tsx` (working-tree / ships with CC).
- **Task 6 — Client dashboards + public pages:** `app/dashboard/**`, `app/u/[slug]/page.tsx`, `app/events/**`, `components/hub/*`.
- **Task 7 — Emails:** `lib/email.ts` (all `toLocale*` in email bodies).

For EACH area task:

- [ ] **Step 1: List the area's sites** from the Task 2 worklist.

- [ ] **Step 2: Replace each time display with the correct helper.** For every `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString`/inline `timeZone:` display in the area's files, look up the source column in the Task 2 table and replace with the matching helper call, importing from `@/lib/studio-time`. Preserve the existing visible format by passing the same `Intl` options via the `opts` parameter. Example transform:
  ```tsx
  // before (booking start_time shown as Eastern — BUG):
  new Date(b.start_time).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Indiana/Indianapolis' })
  // after:
  fmtSessionDateTime(b.start_time)
  ```
  ```tsx
  // before (created_at shown as UTC — should be Eastern):
  new Date(row.created_at).toLocaleString('en-US', { timeZone:'UTC' })
  // after:
  fmtStampDateTime(row.created_at)
  ```
  Leave server-now logic (Conventions list) untouched.

- [ ] **Step 3: Type-check + lint the area.**
  Run: `npx tsc --noEmit` → 0 errors.
  Run: `npx eslint "<area files>"` → 0 errors.

- [ ] **Step 4: Regression spot-check (the safety gate).**
  Pick one known row in that area whose real session time you know (e.g. a `bookings` row from the DB via the Supabase MCP: `SELECT id, start_time FROM bookings ORDER BY start_time DESC LIMIT 3`). Confirm the migrated display renders that session at its intended wall-clock time (e.g. a `18:00:00+00:00` row still shows "6:00 PM", NOT "2:00 PM"). For `fmtStamp*` sites, confirm a known `created_at` now shows Eastern (≈4–5h earlier than the raw UTC). Record the check.

- [ ] **Step 5: Report** the area's changed files + the spot-check result. (No commit — held.)

---

## Task 8: Final verification

- [ ] **Step 1: Grep for un-migrated displays.**
  Run:
  ```bash
  grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString\|timeZone:" app components lib --include=*.ts --include=*.tsx | grep -v node_modules | grep -v "lib/studio-time.ts" | grep -v "scripts/check-studio-time.ts"
  ```
  Every remaining hit must be either (a) server-now/boundary logic on the Conventions KEEP list, or (b) inside `lib/studio-time.ts`. Anything else is an un-migrated display — fix it.

- [ ] **Step 2: Full build + helper script.**
  Run: `npx tsc --noEmit` → 0. `npm run build` → exit 0. `npx tsx scripts/check-studio-time.ts` → passes.

- [ ] **Step 3: Cross-area regression sweep.**
  Re-confirm 3 known booking times (from the DB) render at their correct wall-clock across: an engineer view, an admin view, and a client dashboard view. None shifted.

- [ ] **Step 4: Scope check.**
  Run: `git status --short`. Confirm only intended files changed; server-now routes (`create`, `availability`, the boundary helpers) show NO diff: `git diff --stat app/api/booking/create/route.ts app/api/booking/availability/route.ts app/api/admin/overview/route.ts` → empty.

- [ ] **Step 5: Present diff to owner. Do not commit.**

---

## Self-Review

Performed against the spec:

- **Spec coverage:** §1 goal → Tasks 3–8 (every display → helper). §2 two conventions → Task 1 two families + Task 2 table. §3 current-state → Task 2 Step 1 enumeration. §4 helper → Task 1 (exact code). §5 column table → Task 2 (with ambiguous resolved by evidence in Step 2). §6 server-now untouched → Conventions list + Task 8 Step 4 proof. §7 phasing → Tasks 1→2→3-7→8. §8 verification → per-area Step 4 + Task 8. §9 CC entanglement → Conventions + Task 5. §10 risk → Task 2 evidence-first + per-area spot-checks. All covered.
- **Placeholder scan:** the only deferred items are the two genuinely-ambiguous columns (events, media), which Task 2 Step 2 resolves with a concrete read + evidence before any related display is touched — not a lazy placeholder, it's the audit doing its job.
- **Type consistency:** helper names (`fmtSessionTime/Date/DateTime`, `fmtStampTime/Date/DateTime`) are used identically in Task 1, the area-task examples, and the column table; all import from `@/lib/studio-time`; all take `(iso, opts?)`.
