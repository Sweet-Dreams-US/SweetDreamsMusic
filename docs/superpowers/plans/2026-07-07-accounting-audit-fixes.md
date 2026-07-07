# Admin Accounting — Audit Fixes (proper setup)

> Live, money-critical, READ-ONLY dashboards (no stored money is mutated by these screens —
> risk is only *displaying* a wrong number). Ship in verified slices; reconcile every changed
> figure against the live DB; golden rule: with filters at default, numbers stay byte-identical.

**File:** `components/admin/Accounting.tsx` (2987 lines) + `app/api/admin/accounting/route.ts`.
Helpers: `lib/deposit.ts` (`depositCollectedCents`), `lib/earnings-core.ts` (`computeEarnings`).
`total_amount`, `amount`, `amount_paid`, `final_price_cents` are all **cents**.

## Cole's decisions (2026-07-07)
1. **Per-engineer number** → show BOTH "Generated (gross)" AND "Earnings (take)", clearly labeled.
2. **What We Owe** → owed for the SELECTED period (period earned − period paid); keep all-time balance visible.
3. **Revenue basis** → COLLECTED cash everywhere; booked-but-unpaid shows separately as Outstanding.

## Root causes (proven)
- **$2,150 vs $150 (PRVRB) + "big boxes ignore engineer filter"** — SAME bug. `filteredBookings`/
  `filteredPurchases` are engineer-filtered, but `mediaStats` (line 527, raw `mediaSales`),
  `mediaBookingStats` (line 598, raw `mediaBookings`), and the media portion of `filteredPayrollData`
  (line 922) are NOT. PRVRB's box = real $150 session + ~$1,670 studio-wide media + Hub leak.
  Live proof: PRVRB has ONE $150 booking; studio media_sales = $1,670.
- **Payroll "What We Owe" frozen on period** — `Balance Owed` + `Total Owed (All Time)` (lines 1346, 1404)
  are all-time (earned−paid ever); only "This Period Earned" column changes with `payrollPeriodIndex`.
- **Beat gross counts package-credit face value** (lines 452, 900, 925) — `payment_method` not even
  selected; currently $0 live but wrong.
- **Sessions "revenue" = booked gross** (`total_amount`), not collected; mislabeled.
- **`bookings` not filtered for test rows** (no `is_test` column; `media_bookings` has it).
- **Period boundary** date-string compare (lines 799-816) can drop last-day sessions — Eastern edge.

## Slice A — uniform engineer filter (golden-safe; fixes #2 + #3). SHIP FIRST.
Make the Overview tab's media/Hub numbers engineer-aware. When `engineerFilter==='all'`, identical to today.
- Extract `mediaStats` body → pure `computeMediaStats(sales)`; keep `mediaStats = computeMediaStats(mediaSales)` (Media Sales tab, unchanged).
- Add `filteredMediaSales` memo: `engineerFilter==='all' ? mediaSales : mediaSales.filter(m => [m.sold_by,m.filmed_by,m.edited_by].some(n => normalizeName(n)===engineerFilter))`.
- Add `filteredMediaStats = computeMediaStats(filteredMediaSales)`.
- Extract `mediaBookingStats` body → `computeMediaBookingStats(bookings, installments, offeringMap)`; keep raw for Hub tab.
- Add `filteredMediaBookings` memo: `engineerFilter==='all' ? mediaBookings : []` (Hub contracts have NO per-engineer attribution client-side → a single engineer's Hub revenue is $0, not studio-wide).
- Add `filteredMediaBookingStats = computeMediaBookingStats(filteredMediaBookings, ...)`.
- In `filteredPayrollData` (922) and the OVERVIEW big-box render (1072-1095, Hub 1081-1084, cancelled 1140-1183):
  use `filteredMediaStats`/`filteredMediaBookingStats`/engineer-filtered cancelled. Do NOT touch the Media Sales / Beat Sales / Sessions dedicated tabs.
- Verify: `engineerFilter='all'` → every Overview box identical to pre-change; `engineerFilter=PRVRB` → media/Hub = their attributable only ($0 media) so top "revenue" ≈ $150 (collected) not $2,150.

## Slice B — collected-cash basis (definitional; verify against DB).
- Sessions: replace `total_amount` sums in "revenue" boxes with COLLECTED (`depositCollectedCents` + remainder paid); keep booked as "Outstanding". 
- Media (legacy `media_sales`): `amount` is the sale amount — treat as collected (these are recorded completed sales). Confirm.
- Hub orders: already have `collected` (paid installments + deposit) vs `revenue` (final_price) vs `outstanding` — surface COLLECTED as the revenue box.
- Beats: exclude `payment_method='package_credit'` from cash gross (select the field); show package redemptions separately.
- Relabel every headline box "Collected"; add "Outstanding" where booked>collected.

## Slice C — per-engineer dual columns (Generated + Earnings).
- `sessionsByEngineer` + Overview per-engineer table: add `generatedCents` (gross booking) AND `earningsCents` (their take: session×split + media commission + beat share). Reuse `computeEarnings` per engineer or the split constants. Label columns "Generated (gross)" / "Earnings (take)".

## Slice D — Payroll "What We Owe" = period-scoped.
- Add `periodPaid` per person (payouts within selected period) and show "Owed (this period)" = max(0, periodEarned − periodPaid) as the primary owed column; keep "All-Time Balance" as a secondary column. Ensure period columns recompute on `payrollPeriodIndex` (they do — dep at 913). Fix the period-boundary end to be Eastern end-of-day inclusive.
- Apply engineer filter to the payroll table rows (currently no-op) or hide the dropdown on Payroll.

## Verification (every slice)
- `npx tsc --noEmit` + `npm run build`.
- Live-DB reconciliation of each changed number (query the rows behind it).
- Golden: default filters ⇒ numbers unchanged from production.
- Adversarial money review before merge.
