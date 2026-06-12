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

// --- Row types -----------------------------------------------------------
// The service client has no generated DB types, so each query result is cast
// to an explicit local row type (the pattern used in
// app/api/admin/packages/addon-requests/route.ts) rather than `any`.

interface BookingCoreRow {
  id: string;
  customer_name: string | null;
  start_time: string | null;
  room: string | null;
}

interface RescheduleRow {
  id: string;
  customer_name: string | null;
  start_time: string | null;
  reschedule_reason: string | null;
}

interface UnpaidRow {
  id: string;
  customer_name: string | null;
  start_time: string | null;
  remainder_amount: number | null;
}

interface EntitlementCoreRow {
  id: string;
  user_id: string | null;
  template_id: string | null;
  last_payment_failed_at: string | null;
}

interface CashRow {
  id: string;
  amount: number | null;
  client_name: string | null;
  note: string | null;
  engineer_name: string | null;
  collected_at: string | null;
}

interface AddonRow {
  id: string;
  requested_by_user_id: string | null;
  request_type: string | null;
  quantity: number | null;
  created_at: string | null;
}

interface BalanceRow {
  quantity_granted: number | null;
  quantity_redeemed: number | null;
}

interface ExpiringEntitlementRow {
  id: string;
  user_id: string | null;
  template_id: string | null;
  ends_at: string | null;
  package_entitlement_balances: BalanceRow[] | null;
}

interface ProducerAppRow {
  id: string;
  name: string | null;
  producer_name: string | null;
  created_at: string | null;
}

interface BeatRow {
  id: string;
  title: string | null;
  producer: string | null;
  created_at: string | null;
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
}

interface MediaRequestRow {
  id: string;
  session_kind: string | null;
  starts_at: string | null;
  requested_by: string | null;
  vision: string | null;
}

interface TemplateRow {
  id: string;
  name: string | null;
}

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

// Dedupe a list of nullable ids down to a clean string[].
function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id)));
}

// Look up a name from a hydration map, tolerating a null id.
function nameFrom(map: Map<string, string>, id: string | null): string | undefined {
  return id ? map.get(id) : undefined;
}

// --- Name hydration ------------------------------------------------------
// package_* tables FK to auth.users, not profiles, so client names cannot be
// embedded — they are looked up in a batched second query.

async function fetchUserNames(
  service: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data } = await service
    .from('profiles')
    .select('user_id, display_name')
    .in('user_id', userIds);
  for (const p of (data ?? []) as ProfileRow[]) map.set(p.user_id, p.display_name ?? '');
  return map;
}

async function fetchTemplateNames(
  service: SupabaseClient,
  templateIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (templateIds.length === 0) return map;
  const { data } = await service
    .from('package_templates')
    .select('id, name')
    .in('id', templateIds);
  for (const t of (data ?? []) as TemplateRow[]) map.set(t.id, t.name ?? '');
  return map;
}

// media_session_bookings.starts_at is a TRUE-UTC instant (unlike bookings,
// which store Fort Wayne wall-clock-as-UTC) — so we CONVERT to studio-local
// for display, and compare against real Date.now() for the 72h flag.
function formatMediaWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE,
  });
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
    const rows = (data ?? []) as BookingCoreRow[];
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
    key: 'no_engineer', label: 'Sessions with no engineer', tab: 'bookings', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('bookings')
      .select('id, customer_name, start_time, room', { count: 'exact' })
      .is('engineer_name', null)
      // Unclaimed = paid but no engineer. Post-migration that's 'pending';
      // 'confirmed' kept transitionally (the CHECK makes confirmed+null impossible).
      // NO time filter on purpose: a PAST unclaimed paid session is the MOST
      // urgent kind (customer paid, time passed) — it must surface so an engineer
      // can claim + reschedule it. Overdue rows are flagged below.
      .in('status', ['pending', 'confirmed'])
      .order('start_time', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data ?? []) as BookingCoreRow[];
    const nowMs = new Date(nowISO).getTime();
    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((b): AttentionItem => {
        const base = joinParts(formatSessionWhen(b.start_time), roomLabel(b.room));
        const overdue = !!b.start_time && new Date(b.start_time).getTime() < nowMs;
        return {
          id: b.id,
          primary: b.customer_name || 'Unknown client',
          secondary: overdue ? `⚠ OVERDUE — time passed, needs reschedule · ${base}` : base,
          flagged: true, // a paid session with no engineer is the hottest item
        };
      }),
    };
  } catch (err) {
    console.error('[admin/attention] no_engineer failed:', err);
    return empty;
  }
}

async function buildUnclaimedMediaRequests(service: SupabaseClient): Promise<AttentionCategoryData> {
  const empty: AttentionCategoryData = {
    key: 'unclaimed_media', label: 'Media requests awaiting the team', tab: 'bookings', total: 0, items: [],
  };
  try {
    const { data, error, count } = await service
      .from('media_session_bookings')
      .select('id, session_kind, starts_at, requested_by, vision', { count: 'exact' })
      .eq('status', 'requested')
      .is('media_manager_id', null)
      .order('starts_at', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data ?? []) as MediaRequestRow[];
    if (rows.length === 0) return empty;

    const nameByUser = await fetchUserNames(service, uniqueIds(rows.map((r) => r.requested_by)));
    // Flag requests whose shoot is within 72h (real-UTC comparison).
    const soonMs = Date.now() + 72 * 60 * 60 * 1000;

    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((r): AttentionItem => ({
        id: r.id,
        primary: nameFrom(nameByUser, r.requested_by) || 'Unknown artist',
        secondary: joinParts(
          (r.session_kind || 'shoot').replace('-', ' '),
          formatMediaWhen(r.starts_at),
        ),
        flagged: !!r.starts_at && new Date(r.starts_at).getTime() <= soonMs,
      })),
    };
  } catch (err) {
    console.error('[admin/attention] unclaimed_media failed:', err);
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
      // Deny-list per design spec §5.1: any booking that is not cancelled or
      // completed counts. A status we don't enumerate (e.g. 'approved') must
      // still surface — a missed reschedule request is worse than a stray one.
      .not('status', 'in', '("cancelled","completed")')
      .order('start_time', { ascending: true })
      .limit(CATEGORY_CAP);
    if (error) throw error;
    const rows = (data ?? []) as RescheduleRow[];
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
    const rows = (data ?? []) as UnpaidRow[];
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
    const rows = (data ?? []) as EntitlementCoreRow[];
    if (rows.length === 0) return empty;

    const [nameByUser, nameByTemplate] = await Promise.all([
      fetchUserNames(service, uniqueIds(rows.map((r) => r.user_id))),
      fetchTemplateNames(service, uniqueIds(rows.map((r) => r.template_id))),
    ]);

    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((r): AttentionItem => ({
        id: r.id,
        primary: nameFrom(nameByUser, r.user_id) || 'Unknown client',
        secondary: joinParts(
          nameFrom(nameByTemplate, r.template_id) || 'Membership',
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
    const rows = (data ?? []) as CashRow[];
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
    const rows = (data ?? []) as AddonRow[];
    if (rows.length === 0) return empty;

    const nameByUser = await fetchUserNames(
      service,
      uniqueIds(rows.map((r) => r.requested_by_user_id)),
    );

    return {
      ...empty,
      total: count ?? rows.length,
      items: rows.map((r): AttentionItem => ({
        id: r.id,
        primary: nameFrom(nameByUser, r.requested_by_user_id) || 'Unknown client',
        secondary: joinParts(
          r.quantity && r.quantity > 1
            ? `${r.quantity}× ${r.request_type}`
            : String(r.request_type || 'add-on'),
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
    const rows = (data ?? []) as ExpiringEntitlementRow[];

    const withCredit = rows
      .map((r) => {
        const balances = r.package_entitlement_balances ?? [];
        const remaining = balances.reduce(
          (s, b) => s + ((b.quantity_granted ?? 0) - (b.quantity_redeemed ?? 0)),
          0,
        );
        return { row: r, remaining };
      })
      .filter((x) => x.remaining > 0);
    if (withCredit.length === 0) return empty;

    const [nameByUser, nameByTemplate] = await Promise.all([
      fetchUserNames(service, uniqueIds(withCredit.map((x) => x.row.user_id))),
      fetchTemplateNames(service, uniqueIds(withCredit.map((x) => x.row.template_id))),
    ]);

    return {
      ...empty,
      total: withCredit.length,
      items: withCredit.map(({ row, remaining }): AttentionItem => ({
        id: row.id,
        primary: nameFrom(nameByUser, row.user_id) || 'Unknown client',
        secondary: joinParts(
          nameFrom(nameByTemplate, row.template_id) || 'Package',
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
    const rows = (data ?? []) as ProducerAppRow[];
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
    const rows = (data ?? []) as BeatRow[];
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
    pendingBookings, noEngineer, reschedule, unclaimedMedia,
    unpaidPast, pastDueMemberships, cashCollected,
    addonRequests, expiringCredits,
    producerApplications, beatsPending,
  ] = await Promise.all([
    buildPendingBookings(service),
    buildNoEngineer(service, nowISO),
    buildReschedule(service),
    buildUnclaimedMediaRequests(service),
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
    groupOf('scheduling', 'Scheduling', [pendingBookings, noEngineer, reschedule, unclaimedMedia]),
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
