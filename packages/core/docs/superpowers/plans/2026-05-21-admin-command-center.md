# Admin Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the admin overview into an action-oriented command center that surfaces every item needing an admin decision, each deep-linking to the tab that resolves it.

**Architecture:** A new SELECT-only `GET /api/admin/attention` route runs ten resilient category queries and returns a grouped structure. New role-agnostic `AttentionCenter` / `AttentionGroup` / `AttentionRow` components render it; `AdminOverview` hosts the component and `AdminDashboard` passes a tab-navigation callback. No existing route, booking, session, or payment code is modified.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Supabase (service-role client), lucide-react.

**Design spec:** `docs/superpowers/specs/2026-05-21-admin-command-center-design.md`

---

## Conventions & Notes

**No test framework.** This repo has no Jest/Vitest/Playwright and no `test` script. Do NOT add one — that is out of scope. Each task is verified with:
- `npx tsc --noEmit` — must report zero errors.
- `npm run lint` — must not introduce new errors/warnings.
- `npm run build` (final task) — must succeed.
- Manual checks in the browser, logged in as an admin.

**Resilience.** Spec §6.1 requires that one failing query must not blank the page. This is implemented as a `try/catch` inside each category builder that returns an empty category on error — an equivalent guarantee to `Promise.allSettled`, and cleaner because each builder owns its own empty-state identity.

**Timezone.** Booking `start_time` values are Fort Wayne wall-clock time stored as UTC, so session times are formatted with `timeZone: 'UTC'` (which recovers the intended local time); `created_at`-style timestamps are formatted with `timeZone: TIMEZONE`. This route reuses the existing Fort Wayne "now" approach from `app/api/admin/overview/route.ts` and introduces no new timezone logic. NOTE: `AdminOverview`'s existing "Recent Bookings" list formats `start_time` with `timeZone: TIMEZONE` — a pre-existing bug owned by the separate sitewide timezone audit. It is deliberately NOT fixed here.

**Commits.** Each task ends with a commit. Confirm with the repo owner that per-task committing is acceptable before starting.

**Safety.** No task modifies any booking, session, payment, or existing API-route file. The only modified existing files are `components/admin/AdminOverview.tsx` and one line of `components/admin/AdminDashboard.tsx`.

---

## File Structure

**Created:**
- `components/admin/attention/types.ts` — shared TypeScript types for the attention data shape. Types-only; safe to import from both the server route and client components.
- `app/api/admin/attention/route.ts` — `GET` endpoint. Auth-gated, SELECT-only. Runs 10 resilient category builders, returns the grouped `AttentionResponse`.
- `components/admin/attention/AttentionRow.tsx` — presentational, role-agnostic. One clickable item row.
- `components/admin/attention/AttentionGroup.tsx` — presentational, role-agnostic. One bucket: header + per-category sub-lists with a 5-row cap and "show all" expander; renders an "all clear" line when empty.
- `components/admin/attention/AttentionCenter.tsx` — fetches `/api/admin/attention`, owns loading/error/empty states, renders the master count + groups.

**Modified:**
- `components/admin/AdminOverview.tsx` — render `<AttentionCenter/>` at the top, remove the "Quick Status" block, accept and forward an `onNavigate` prop, restructure so the attention block renders independently of the overview KPI fetch.
- `components/admin/AdminDashboard.tsx` — pass `onNavigate` to `<AdminOverview/>` (one line).

The three `Attention*` components are deliberately split: `Row` and `Group` are pure presentational units with no data fetching, so the future engineer and producer command centers can reuse them with a different data source.

---

## Task 1: Shared types

**Files:**
- Create: `components/admin/attention/types.ts`

- [ ] **Step 1: Create the types file**

Create `components/admin/attention/types.ts`:

```typescript
// Shared types for the Admin Command Center ("Needs Your Attention").
// Imported by both the API route (server) and the components (client) —
// keep this file types-only so it is safe on both sides.

/** Admin dashboard tab keys a row can deep-link to.
 *  Subset of the `Tab` union in components/admin/AdminDashboard.tsx. */
export type AdminTab = 'bookings' | 'accounting' | 'packages' | 'producers' | 'beats';

/** One actionable item — rendered as a single clickable row. */
export interface AttentionItem {
  /** Stable unique id (the underlying DB row id). */
  id: string;
  /** Main label — the person or thing (e.g. a client name). */
  primary: string;
  /** Supporting detail — date, amount, reason (pre-formatted, display-ready). */
  secondary: string;
  /** When true the row is styled as highest-priority. */
  flagged?: boolean;
}

/** A labeled list of items of one kind, inside a group. */
export interface AttentionCategoryData {
  /** Stable key, e.g. 'pending_bookings'. */
  key: string;
  /** Human label, e.g. 'Bookings awaiting approval'. */
  label: string;
  /** True total count (may exceed items.length when capped). */
  total: number;
  /** Admin tab this category's rows deep-link to. */
  tab: AdminTab;
  /** Items, capped server-side. */
  items: AttentionItem[];
}

/** One of the four buckets. */
export interface AttentionGroupData {
  key: string;
  label: string;
  /** Sum of category totals. */
  count: number;
  /** Non-empty categories only. */
  categories: AttentionCategoryData[];
}

/** Full payload returned by GET /api/admin/attention. */
export interface AttentionResponse {
  /** Sum of all group counts. */
  totalCount: number;
  groups: AttentionGroupData[];
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/attention/types.ts
git commit -m "feat: add Admin Command Center shared types"
```

---

## Task 2: Attention API route

**Files:**
- Create: `app/api/admin/attention/route.ts`

This is the largest task — one cohesive file containing helpers, ten category builders, and the `GET` handler. Every builder has its own `try/catch` and returns an empty category on failure.

> **Implementation note (applied 2026-05-21):** the route was implemented with explicit local row interfaces (`BookingCoreRow`, `ProfileRow`, etc.) plus two `fetchUserNames` / `fetchTemplateNames` hydration helpers, replacing the `as any[]` casts shown in the Step 1 code block below. Reason: `@typescript-eslint/no-explicit-any` is an *error* in this repo's ESLint config, so `any` casts fail `npm run lint`. Behavior is unchanged. The file on disk (`app/api/admin/attention/route.ts`) is the source of truth.

- [ ] **Step 1: Create the route file**

Create `app/api/admin/attention/route.ts` with this exact content:

```typescript
// GET /api/admin/attention — powers the admin "Needs Your Attention"
// command center. SELECT-only: this route never mutates data.
//
// Resilience: each category builder has its own try/catch and returns an
// empty category on failure, so one broken query degrades that category to
// empty rather than blanking the whole command center (design spec §6.1).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { formatCents } from '@/lib/utils';
import { ROOM_LABELS, TIMEZONE, type Room } from '@/lib/constants';
import type {
  AttentionItem,
  AttentionCategoryData,
  AttentionGroupData,
  AttentionResponse,
} from '@/components/admin/attention/types';

// Max rows returned per category. The UI shows 5 and expands up to this.
const CATEGORY_CAP = 50;
// "Expiring soon" window for package credits.
const EXPIRING_SOON_DAYS = 30;

// --- Time helpers --------------------------------------------------------
// Booking timestamps are stored as Fort Wayne wall-clock time. "Now"
// comparisons must therefore use a Fort Wayne wall-clock now, mirroring
// app/api/admin/overview/route.ts. Consolidating all timezone logic is a
// separate tracked effort (the sitewide timezone audit).

function fortWayneNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

function toPlainISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// start_time holds Fort Wayne wall-clock time stored as UTC; formatting with
// timeZone:'UTC' recovers the intended local time.
function formatSessionWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  });
}

function formatSessionDay(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// created_at-style timestamps: show the calendar day in studio-local time.
function formatEventDay(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: TIMEZONE,
  });
}

function roomLabel(room: string | null): string {
  if (!room) return '';
  return ROOM_LABELS[room as Room] ?? '';
}

function joinParts(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

// --- Category builders ---------------------------------------------------

async function buildPendingBookings(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'pending_bookings', label: 'Bookings awaiting approval', tab: 'bookings', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('bookings')
      .select('id, customer_name, start_time, room', { count: 'exact' })
      .in('status', ['pending', 'pending_approval'])
      .order('start_time', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((b): AttentionItem => ({
        id: b.id,
        primary: b.customer_name || 'Unknown client',
        secondary: joinParts(formatSessionWhen(b.start_time), roomLabel(b.room)),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] pending_bookings failed:', err);
    return empty;
  }
}

async function buildNoEngineer(service: SupabaseClient, nowISO: string): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'no_engineer', label: 'Upcoming sessions with no engineer', tab: 'bookings', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('bookings')
      .select('id, customer_name, start_time, room', { count: 'exact' })
      .is('engineer_name', null)
      .gte('start_time', nowISO)
      .eq('status', 'confirmed')
      .order('start_time', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((b): AttentionItem => ({
        id: b.id,
        primary: b.customer_name || 'Unknown client',
        secondary: joinParts(formatSessionWhen(b.start_time), roomLabel(b.room)),
        flagged: true, // a confirmed session with no engineer is the hottest item
      })),
    };
  } catch (err) {
    console.error('[admin/attention] no_engineer failed:', err);
    return empty;
  }
}

async function buildReschedule(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'reschedule_requests', label: 'Reschedule requests', tab: 'bookings', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('bookings')
      .select('id, customer_name, start_time, reschedule_reason', { count: 'exact' })
      .eq('reschedule_requested', true)
      .in('status', ['pending', 'pending_approval', 'confirmed'])
      .order('start_time', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((b): AttentionItem => ({
        id: b.id,
        primary: b.customer_name || 'Unknown client',
        secondary: joinParts(formatSessionWhen(b.start_time), b.reschedule_reason),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] reschedule_requests failed:', err);
    return empty;
  }
}

async function buildUnpaidPast(service: SupabaseClient, nowISO: string): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'unpaid_past', label: 'Unpaid balances on past sessions', tab: 'bookings', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('bookings')
      .select('id, customer_name, start_time, remainder_amount', { count: 'exact' })
      .gt('remainder_amount', 0)
      .lt('start_time', nowISO)
      .in('status', ['confirmed', 'completed'])
      .order('start_time', { ascending: true }) // oldest unpaid first
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((b): AttentionItem => ({
        id: b.id,
        primary: b.customer_name || 'Unknown client',
        secondary: joinParts(
          `${formatCents(b.remainder_amount || 0)} owed`,
          `session ${formatSessionDay(b.start_time)}`,
        ),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] unpaid_past failed:', err);
    return empty;
  }
}

async function buildPastDueMemberships(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'past_due_memberships', label: 'Past-due memberships', tab: 'packages', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('package_entitlements')
      .select('id, user_id, template_id, last_payment_failed_at', { count: 'exact' })
      .in('payment_status', ['past_due', 'collections'])
      .order('last_payment_failed_at', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    if (rows.length === 0) return empty;

    // package_entitlements.user_id FKs to auth.users, not profiles — embed is
    // impossible, so hydrate names with batched .in() lookups (the pattern in
    // app/api/admin/packages/addon-requests/route.ts).
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const tplIds = Array.from(new Set(rows.map((r) => r.template_id).filter(Boolean)));
    const [profilesRes, templatesRes] = await Promise.all([
      userIds.length
        ? service.from('profiles').select('user_id, display_name').in('user_id', userIds)
        : Promise.resolve({ data: [] as any[] }),
      tplIds.length
        ? service.from('package_templates').select('id, name').in('id', tplIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const nameByUser = new Map<string, string>();
    for (const p of (profilesRes.data || []) as any[]) nameByUser.set(p.user_id, p.display_name || '');
    const tplById = new Map<string, string>();
    for (const t of (templatesRes.data || []) as any[]) tplById.set(t.id, t.name || '');

    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((r): AttentionItem => ({
        id: r.id,
        primary: nameByUser.get(r.user_id) || 'Unknown client',
        secondary: joinParts(
          tplById.get(r.template_id) || 'Membership',
          r.last_payment_failed_at
            ? `payment failed ${formatEventDay(r.last_payment_failed_at)}`
            : 'payment past due',
        ),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] past_due_memberships failed:', err);
    return empty;
  }
}

async function buildCashCollected(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'cash_collected', label: 'Cash collected, not deposited', tab: 'accounting', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('cash_ledger')
      .select('id, amount, client_name, note, engineer_name, collected_at', { count: 'exact' })
      .eq('status', 'collected')
      .order('collected_at', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((c): AttentionItem => ({
        id: c.id,
        primary: `${formatCents(c.amount || 0)} cash`,
        secondary: joinParts(
          c.client_name || c.note,
          c.engineer_name ? `collected by ${c.engineer_name}` : '',
          c.collected_at ? formatEventDay(c.collected_at) : '',
        ),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] cash_collected failed:', err);
    return empty;
  }
}

async function buildAddonRequests(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'addon_requests', label: 'Package add-on requests', tab: 'packages', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('package_addon_requests')
      .select('id, requested_by_user_id, request_type, quantity, created_at', { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    if (rows.length === 0) return empty;

    const userIds = Array.from(new Set(rows.map((r) => r.requested_by_user_id).filter(Boolean)));
    const profilesRes = userIds.length
      ? await service.from('profiles').select('user_id, display_name').in('user_id', userIds)
      : { data: [] as any[] };
    const nameByUser = new Map<string, string>();
    for (const p of (profilesRes.data || []) as any[]) nameByUser.set(p.user_id, p.display_name || '');

    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((r): AttentionItem => ({
        id: r.id,
        primary: nameByUser.get(r.requested_by_user_id) || 'Unknown client',
        secondary: joinParts(
          r.quantity && r.quantity > 1 ? `${r.quantity}× ${r.request_type}` : String(r.request_type || 'add-on'),
          `requested ${formatEventDay(r.created_at)}`,
        ),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] addon_requests failed:', err);
    return empty;
  }
}

async function buildExpiringCredits(
  service: SupabaseClient,
  nowISO: string,
  in30ISO: string,
): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'expiring_credits', label: 'Package credits expiring soon', tab: 'packages', total: 0, items: [],
  };
  try {
    // package_entitlement_balances has a real FK to package_entitlements, so
    // it CAN be embedded. Credit-remaining is filtered in JS (PostgREST has
    // no cross-row aggregate filter).
    const { data, error } = await service
      .from('package_entitlements')
      .select('id, user_id, template_id, ends_at, package_entitlement_balances(quantity_granted, quantity_redeemed)')
      .eq('status', 'active')
      .gte('ends_at', nowISO)
      .lte('ends_at', in30ISO)
      .order('ends_at', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];

    const withCredit = rows
      .map((r) => {
        const balances = (r.package_entitlement_balances || []) as any[];
        const remaining = balances.reduce(
          (s, b) => s + ((b.quantity_granted || 0) - (b.quantity_redeemed || 0)),
          0,
        );
        return { row: r, remaining };
      })
      .filter((x) => x.remaining > 0);
    if (withCredit.length === 0) return empty;

    const userIds = Array.from(new Set(withCredit.map((x) => x.row.user_id).filter(Boolean)));
    const tplIds = Array.from(new Set(withCredit.map((x) => x.row.template_id).filter(Boolean)));
    const [profilesRes, templatesRes] = await Promise.all([
      userIds.length
        ? service.from('profiles').select('user_id, display_name').in('user_id', userIds)
        : Promise.resolve({ data: [] as any[] }),
      tplIds.length
        ? service.from('package_templates').select('id, name').in('id', tplIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const nameByUser = new Map<string, string>();
    for (const p of (profilesRes.data || []) as any[]) nameByUser.set(p.user_id, p.display_name || '');
    const tplById = new Map<string, string>();
    for (const t of (templatesRes.data || []) as any[]) tplById.set(t.id, t.name || '');

    return {
      ...empty,
      total: withCredit.length,
      items: withCredit.map(({ row, remaining }): AttentionItem => ({
        id: row.id,
        primary: nameByUser.get(row.user_id) || 'Unknown client',
        secondary: joinParts(
          tplById.get(row.template_id) || 'Package',
          `${remaining} credit${remaining === 1 ? '' : 's'} left`,
          `expires ${formatEventDay(row.ends_at)}`,
        ),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] expiring_credits failed:', err);
    return empty;
  }
}

async function buildProducerApplications(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'producer_applications', label: 'Producer applications to review', tab: 'producers', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('producer_applications')
      .select('id, name, producer_name, created_at', { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((r): AttentionItem => ({
        id: r.id,
        primary: r.name || r.producer_name || 'Unknown applicant',
        secondary: `applied ${formatEventDay(r.created_at)}`,
      })),
    };
  } catch (err) {
    console.error('[admin/attention] producer_applications failed:', err);
    return empty;
  }
}

async function buildBeatsPendingReview(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'beats_pending', label: 'Beats pending review', tab: 'beats', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('beats')
      .select('id, title, producer, created_at', { count: 'exact' })
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data || []) as any[];
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((r): AttentionItem => ({
        id: r.id,
        primary: r.title || 'Untitled beat',
        secondary: joinParts(
          r.producer ? `by ${r.producer}` : '',
          `submitted ${formatEventDay(r.created_at)}`,
        ),
      })),
    };
  } catch (err) {
    console.error('[admin/attention] beats_pending failed:', err);
    return empty;
  }
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const now = fortWayneNow();
  const nowISO = toPlainISO(now);
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + EXPIRING_SOON_DAYS);
  const in30ISO = toPlainISO(in30);

  const [
    pendingBookings, noEngineer, reschedule,
    unpaidPast, pastDueMemberships, cashCollected,
    addonRequests, expiringCredits,
    producerApplications, beatsPending,
  ] = await Promise.all([
    buildPendingBookings(service),
    buildNoEngineer(service, nowISO),
    buildReschedule(service),
    buildUnpaidPast(service, nowISO),
    buildPastDueMemberships(service),
    buildCashCollected(service),
    buildAddonRequests(service),
    buildExpiringCredits(service, nowISO, in30ISO),
    buildProducerApplications(service),
    buildBeatsPendingReview(service),
  ]);

  const groupOf = (key: string, label: string, cats: AttentionCategoryData[]): AttentionGroupData => {
    const nonEmpty = cats.filter((c) => c.total > 0);
    return { key, label, count: nonEmpty.reduce((s, c) => s + c.total, 0), categories: nonEmpty };
  };

  const groups: AttentionGroupData[] = [
    groupOf('scheduling', 'Scheduling', [pendingBookings, noEngineer, reschedule]),
    groupOf('money', 'Money to Chase', [unpaidPast, pastDueMemberships, cashCollected]),
    groupOf('sales', 'Sales & Upsells', [addonRequests, expiringCredits]),
    groupOf('people', 'People & Content', [producerApplications, beatsPending]),
  ];

  const response: AttentionResponse = {
    totalCount: groups.reduce((s, g) => s + g.count, 0),
    groups,
  };
  return NextResponse.json(response);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: completes with no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors or warnings for `app/api/admin/attention/route.ts`.

- [ ] **Step 4: Verify the route responds**

Ensure the dev server is running (`npm run dev`). In a browser where you are logged in as an admin, open `http://localhost:3000/api/admin/attention`.
Expected: a JSON response shaped `{"totalCount": <number>, "groups": [ ...4 groups: scheduling, money, sales, people... ]}`. NOT a 401 or 500. If you get 401, log in as an admin first.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/attention/route.ts
git commit -m "feat: add admin attention API route"
```

---

## Task 3: AttentionRow component

**Files:**
- Create: `components/admin/attention/AttentionRow.tsx`

- [ ] **Step 1: Create the component**

Create `components/admin/attention/AttentionRow.tsx`:

```tsx
'use client';

import { ChevronRight } from 'lucide-react';
import type { AttentionItem } from './types';

/** One actionable row. The whole row is a button that deep-links to a tab. */
export default function AttentionRow({
  item,
  onClick,
}: {
  item: AttentionItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between gap-3 px-4 py-3 border-l-2 transition-colors hover:bg-black/[0.03] ${
        item.flagged ? 'border-red-500 bg-red-50/50' : 'border-transparent'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold truncate">{item.primary}</p>
        {item.secondary && (
          <p className="font-mono text-xs text-black/45 truncate">{item.secondary}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-black/30 shrink-0" />
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/attention/AttentionRow.tsx
git commit -m "feat: add AttentionRow component"
```

---

## Task 4: AttentionGroup component

**Files:**
- Create: `components/admin/attention/AttentionGroup.tsx`

- [ ] **Step 1: Create the component**

Create `components/admin/attention/AttentionGroup.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { AttentionGroupData, AttentionCategoryData, AdminTab } from './types';
import AttentionRow from './AttentionRow';

/** How many rows of a category show before the "show all" expander. */
const VISIBLE_LIMIT = 5;

function CategoryBlock({
  category,
  onNavigate,
}: {
  category: AttentionCategoryData;
  onNavigate: (tab: AdminTab) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? category.items : category.items.slice(0, VISIBLE_LIMIT);
  const hidden = category.items.length - visible.length;

  return (
    <div className="py-1">
      <div className="flex items-baseline gap-2 px-4 pt-2 pb-1">
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-black/70">
          {category.label}
        </span>
        <span className="font-mono text-[10px] text-black/40">{category.total}</span>
      </div>
      <div className="divide-y divide-black/5">
        {visible.map((item) => (
          <AttentionRow key={item.id} item={item} onClick={() => onNavigate(category.tab)} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="font-mono text-[11px] uppercase tracking-wider text-black/45 hover:text-black px-4 py-2 transition-colors"
        >
          Show all {category.items.length} &rarr;
        </button>
      )}
    </div>
  );
}

/** One bucket — header + per-category sub-lists, or an "all clear" line. */
export default function AttentionGroup({
  group,
  onNavigate,
}: {
  group: AttentionGroupData;
  onNavigate: (tab: AdminTab) => void;
}) {
  if (group.categories.length === 0) {
    return (
      <div className="border-2 border-black/10 px-4 py-3 flex items-center gap-3">
        <span className="font-mono text-sm font-bold uppercase tracking-wider text-black/40">
          {group.label}
        </span>
        <span className="font-mono text-xs text-green-700">&#10003; all clear</span>
      </div>
    );
  }

  return (
    <div className="border-2 border-black/10">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-black/[0.02] border-b-2 border-black/10">
        <span className="font-mono text-sm font-bold uppercase tracking-wider">{group.label}</span>
        <span className="font-mono text-xs text-black/40">({group.count})</span>
      </div>
      <div className="divide-y-2 divide-black/5">
        {group.categories.map((c) => (
          <CategoryBlock key={c.key} category={c} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/attention/AttentionGroup.tsx
git commit -m "feat: add AttentionGroup component"
```

---

## Task 5: AttentionCenter component

**Files:**
- Create: `components/admin/attention/AttentionCenter.tsx`

- [ ] **Step 1: Create the component**

Create `components/admin/attention/AttentionCenter.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import type { AttentionResponse, AdminTab } from './types';
import AttentionGroup from './AttentionGroup';

/** The "Needs Your Attention" command center. Fetches its own data and
 *  owns loading / error / empty states — independent of the rest of the
 *  overview page. */
export default function AttentionCenter({
  onNavigate,
}: {
  onNavigate: (tab: AdminTab) => void;
}) {
  const [data, setData] = useState<AttentionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/admin/attention')
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((json: AttentionResponse) => setData(json))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="border-2 border-black/10 p-6">
        <div className="font-mono text-sm uppercase tracking-wider text-black/40 animate-pulse">
          Loading your attention items...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border-2 border-red-200 bg-red-50 p-4">
        <p className="font-mono text-xs text-red-600">
          Couldn&apos;t load attention items. The rest of your dashboard is unaffected.
        </p>
      </div>
    );
  }

  if (data.totalCount === 0) {
    return (
      <div className="border-2 border-black/10 p-6 text-center">
        <p className="font-mono text-sm font-bold uppercase tracking-wider text-black/60">
          Nothing needs your attention right now
        </p>
        <p className="font-mono text-xs text-black/35 mt-1">All clear.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider">
          Needs Your Attention
        </h2>
        <span className="font-mono text-xs text-black/40">
          {data.totalCount} item{data.totalCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-3">
        {data.groups.map((g) => (
          <AttentionGroup key={g.key} group={g} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: completes with no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors or warnings for the three attention components.

- [ ] **Step 4: Commit**

```bash
git add components/admin/attention/AttentionCenter.tsx
git commit -m "feat: add AttentionCenter component"
```

---

## Task 6: Wire the command center into the dashboard

**Files:**
- Modify: `components/admin/AdminOverview.tsx` (full file replacement)
- Modify: `components/admin/AdminDashboard.tsx` (one line)

- [ ] **Step 1: Replace `AdminOverview.tsx`**

Replace the ENTIRE contents of `components/admin/AdminOverview.tsx` with:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Calendar, DollarSign, Users, Music, ShoppingBag } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import AttentionCenter from './attention/AttentionCenter';
import type { AdminTab } from './attention/types';

interface OverviewData {
  today: { sessions: number; revenue: number; signups: number };
  week: { sessions: number; revenue: number; beatsSold: number; beatsRevenue: number };
  month: {
    sessions: number;
    revenue: number;
    beatsSold: number;
    beatsRevenue: number;
    mediaSales: number;
    mediaRevenue: number;
  };
  status: { pendingBookings: number; upcomingSessions: number; outstandingRemainders: number };
  recentBookings: { id: string; name: string; date: string; status: string; amount: number }[];
  recentBeatSales: {
    id: string;
    buyer: string;
    title: string;
    producer: string;
    license: string;
    amount: number;
    date: string;
  }[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  pending_approval: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  rejected: 'bg-red-100 text-red-600',
};

function KpiCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
  sub?: string;
}) {
  return (
    <div className="border-2 border-black/10 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-black/40" />
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-black/50">
          {label}
        </span>
      </div>
      <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight">{value}</p>
      {sub && <p className="font-mono text-xs text-black/40 mt-1">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-black/50 mb-3">
      {children}
    </h3>
  );
}

export default function AdminOverview({ onNavigate }: { onNavigate: (tab: AdminTab) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/overview')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load overview');
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Indiana/Indianapolis',
    });
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Indiana/Indianapolis',
    });
  };

  return (
    <div className="space-y-8">
      {/* COMMAND CENTER — independent fetch; renders regardless of the KPI fetch below */}
      <AttentionCenter onNavigate={onNavigate} />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="font-mono text-sm uppercase tracking-wider text-black/40 animate-pulse">
            Loading overview...
          </div>
        </div>
      )}

      {!loading && (error || !data) && (
        <div className="border-2 border-red-200 bg-red-50 p-6 text-center">
          <p className="font-mono text-sm text-red-600">{error || 'Failed to load'}</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* TODAY */}
          <div>
            <SectionTitle>Today</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard label="Sessions Today" value={String(data.today.sessions)} icon={Calendar} />
              <KpiCard
                label="Revenue Today"
                value={formatCents(data.today.revenue)}
                icon={DollarSign}
                sub="Deposits collected"
              />
              <KpiCard label="New Signups" value={String(data.today.signups)} icon={Users} />
            </div>
          </div>

          {/* THIS WEEK */}
          <div>
            <SectionTitle>This Week</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard label="Sessions" value={String(data.week.sessions)} icon={Calendar} />
              <KpiCard label="Session Revenue" value={formatCents(data.week.revenue)} icon={DollarSign} />
              <KpiCard
                label="Beats Sold"
                value={String(data.week.beatsSold)}
                icon={Music}
                sub={data.week.beatsRevenue > 0 ? formatCents(data.week.beatsRevenue) : undefined}
              />
            </div>
          </div>

          {/* THIS MONTH */}
          <div>
            <SectionTitle>This Month</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Total Sessions" value={String(data.month.sessions)} icon={Calendar} />
              <KpiCard label="Session Revenue" value={formatCents(data.month.revenue)} icon={DollarSign} />
              <KpiCard
                label="Beats Sold"
                value={String(data.month.beatsSold)}
                icon={Music}
                sub={data.month.beatsRevenue > 0 ? formatCents(data.month.beatsRevenue) : undefined}
              />
              <KpiCard
                label="Media Sales"
                value={String(data.month.mediaSales)}
                icon={ShoppingBag}
                sub={data.month.mediaRevenue > 0 ? formatCents(data.month.mediaRevenue) : undefined}
              />
            </div>
          </div>

          {/* RECENT ACTIVITY */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Recent Bookings */}
            <div>
              <SectionTitle>Recent Bookings</SectionTitle>
              <div className="border-2 border-black/10 divide-y divide-black/5">
                {data.recentBookings.length === 0 ? (
                  <div className="p-4 text-center font-mono text-sm text-black/40">
                    No bookings yet
                  </div>
                ) : (
                  data.recentBookings.map((b) => (
                    <div key={b.id} className="p-3 sm:p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold truncate">{b.name}</p>
                        <p className="font-mono text-xs text-black/40">{formatDateTime(b.date)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-mono text-xs font-semibold">{formatCents(b.amount)}</span>
                        <span
                          className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            STATUS_COLORS[b.status] || 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {b.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent Beat Sales */}
            <div>
              <SectionTitle>Recent Beat Sales</SectionTitle>
              <div className="border-2 border-black/10 divide-y divide-black/5">
                {data.recentBeatSales.length === 0 ? (
                  <div className="p-4 text-center font-mono text-sm text-black/40">
                    No beat sales yet
                  </div>
                ) : (
                  data.recentBeatSales.map((s) => (
                    <div key={s.id} className="p-3 sm:p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold truncate">{s.title}</p>
                        <p className="font-mono text-xs text-black/40 truncate">
                          {s.buyer} &middot; {s.license}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="font-mono text-sm font-semibold">{formatCents(s.amount)}</p>
                        <p className="font-mono text-[10px] text-black/40">{formatDate(s.date)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

What changed from the original: removed the `Clock`, `TrendingUp`, `AlertCircle` imports (only used by the deleted block); added the `AttentionCenter` + `AdminTab` imports; added the `onNavigate` prop; moved `formatDate`/`formatDateTime` above the `return`; replaced the loading/error early-returns with inline conditionals so `<AttentionCenter/>` always renders; deleted the entire `{/* QUICK STATUS */}` block. The `OverviewData.status` field is intentionally kept (the overview API still returns it) though it is no longer rendered.

- [ ] **Step 2: Edit `AdminDashboard.tsx`**

In `components/admin/AdminDashboard.tsx`, find this line:

```tsx
          {tab === 'overview' && <AdminOverview />}
```

Replace it with:

```tsx
          {tab === 'overview' && <AdminOverview onNavigate={(t) => setTab(t)} />}
```

(`setTab` is already in scope; the arrow wrapper keeps the prop type `(tab: AdminTab) => void` satisfied regardless of `Tab`-union variance.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: completes with no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors or warnings.

- [ ] **Step 5: Manual smoke test**

With the dev server running and logged in as an admin, open the admin dashboard on the **Overview** tab. Confirm:
- A "Needs Your Attention" block renders at the **top** of the page.
- Group headers (Scheduling / Money to Chase / Sales & Upsells / People & Content) appear; empty groups show a "&#10003; all clear" line; if everything is empty, a single "Nothing needs your attention" panel shows instead.
- Clicking any attention row switches the dashboard to the matching tab (Bookings / Accounting / Packages / Producers / Beats).
- The KPI cards (Today / This Week / This Month) and the Recent Bookings / Recent Beat Sales lists still render, below the attention block.
- The old "Quick Status" row is gone.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AdminOverview.tsx components/admin/AdminDashboard.tsx
git commit -m "feat: wire Admin Command Center into the overview dashboard"
```

---

## Task 7: Final verification

**Files:** none changed (verification only).

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build completes successfully with no type or lint errors.

- [ ] **Step 2: Full smoke test**

With the dev server running, logged in as an admin:
- Overview tab: attention block renders; per-category counts look correct against known data; a category with more than 5 items shows "Show all N" and expands inline when clicked.
- Click one row from each group and confirm it lands on the correct tab.
- Confirm KPI cards and Recent lists are unchanged.
- Temporarily, if practical, confirm the page still renders if the attention route fails (e.g. it shows the small red "Couldn't load attention items" notice rather than a blank page).

- [ ] **Step 3: Confirm change scope**

Run: `git diff --stat main -- . ":(exclude)docs"`
Expected: only these files appear — `app/api/admin/attention/route.ts`, `components/admin/attention/types.ts`, `components/admin/attention/AttentionRow.tsx`, `components/admin/attention/AttentionGroup.tsx`, `components/admin/attention/AttentionCenter.tsx`, `components/admin/AdminOverview.tsx`, `components/admin/AdminDashboard.tsx`. No booking, session, payment, or other API-route files. (If the working branch is not off `main`, compare against the actual base branch.)

- [ ] **Step 4: Done**

No commit needed unless Steps 1–3 surfaced a fix. If a fix was made, commit it with a clear message and re-run Step 1.

---

## Self-Review

Performed against the design spec after drafting:

- **Spec coverage:** §4 layout → Tasks 5 & 6; §5 the ten items + detection rules → Task 2 builders; §5.5 per-category cap → Task 4 (`VISIBLE_LIMIT`); §6 data/API + Fort Wayne now → Task 2; §7 components → Tasks 3–6; §8 deep-link / no refresh button / loading / resilience → Tasks 2, 5, 6; §9 safety → Conventions + Task 7 Step 3; §10 tunable defaults (`EXPIRING_SOON_DAYS=30`, cap `5`, all-clear collapse) → Tasks 2 & 4; §11 verification → Tasks 2, 6, 7. All covered.
- **Placeholders:** none — every step has complete code or an exact command.
- **Type consistency:** `AdminTab`, `AttentionItem`, `AttentionCategoryData`, `AttentionGroupData`, `AttentionResponse` are defined once in Task 1 and used identically by the route and all components; `onNavigate: (tab: AdminTab) => void` is threaded consistently from `AdminDashboard` → `AdminOverview` → `AttentionCenter` → `AttentionGroup` → `AttentionRow`.
