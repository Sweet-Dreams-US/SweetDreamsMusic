// lib/events-server.ts
//
// Server-only events helpers. Same boundary rule as bands-server.ts:
// imports the service Supabase client, so it MUST NOT be imported from any
// client component.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase/server';
import type { EventRsvp, EventRsvpStatus, EventWithRsvp, SweetEvent } from './events';

// ============================================================
// Public listing queries
// ============================================================

/**
 * Get upcoming events for the public /events page. Returns only `public` and
 * `private_listed` events that are not cancelled and start in the future.
 *
 * `private_hidden` events are deliberately excluded — they're only reachable
 * via direct invitation link (see `getEventByToken`) or the admin UI.
 */
export async function getUpcomingListedEvents(
  client?: SupabaseClient,
): Promise<SweetEvent[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .in('visibility', ['public', 'private_listed'])
    .eq('is_cancelled', false)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });

  if (error) {
    console.error('[events] getUpcomingListedEvents error:', error);
    return [];
  }
  return (data || []) as SweetEvent[];
}

/**
 * Get a single event by slug. Does NOT enforce visibility — callers are
 * responsible for deciding whether to expose private_hidden events (e.g.
 * the admin page yes, the public page no).
 */
export async function getEventBySlug(
  slug: string,
  client?: SupabaseClient,
): Promise<SweetEvent | null> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return (data as SweetEvent | null) ?? null;
}

/**
 * Get an event by its ID. Used by admin routes and webhook handlers.
 */
export async function getEventById(
  id: string,
  client?: SupabaseClient,
): Promise<SweetEvent | null> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as SweetEvent | null) ?? null;
}

// ============================================================
// RSVP queries
// ============================================================

/**
 * All RSVPs + invitations + requests for a given event. Admin-side use.
 */
export async function getRsvpsForEvent(
  eventId: string,
  client?: SupabaseClient,
): Promise<EventRsvp[]> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('event_rsvps')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  return (data || []) as EventRsvp[];
}

/**
 * Count confirmed attendees (status='going') + their guests for capacity math.
 * We count `going` rows only — `invited` / `maybe` / `requested` don't count
 * against capacity.
 */
export async function getConfirmedAttendeeCount(
  eventId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('event_rsvps')
    .select('guest_count')
    .eq('event_id', eventId)
    .eq('status', 'going');
  if (!data) return 0;
  return (data as { guest_count: number }[])
    .reduce((acc, r) => acc + 1 + (r.guest_count || 0), 0);
}

/**
 * Look up a single user's RSVP row for an event. Null if none.
 */
export async function getUserRsvp(
  eventId: string,
  userId: string,
  client?: SupabaseClient,
): Promise<EventRsvp | null> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('event_rsvps')
    .select('*')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as EventRsvp | null) ?? null;
}

/**
 * Events a user has an RSVP row on — includes invites, confirmed going,
 * requested, etc. Powers the user's /dashboard/events page.
 *
 * We exclude `not_going` rows so declined events don't clutter the dashboard.
 * If users want a history, we can add a `?history=true` toggle later.
 */
export async function getEventsForUser(
  userId: string,
  client?: SupabaseClient,
): Promise<EventWithRsvp[]> {
  const supabase = client || createServiceClient();

  // Fetch RSVPs first, then join events in a second query — same reason as
  // the bands code: we want to order by event start time and return full
  // event rows, which is cleaner as two queries than a nested select.
  const { data: rsvpRows } = await supabase
    .from('event_rsvps')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'not_going')
    .order('created_at', { ascending: false });

  const rsvps = (rsvpRows || []) as EventRsvp[];
  if (rsvps.length === 0) return [];

  const eventIds = Array.from(new Set(rsvps.map((r) => r.event_id)));
  const { data: eventRows } = await supabase
    .from('events')
    .select('*')
    .in('id', eventIds);

  const eventMap = new Map<string, SweetEvent>();
  for (const e of (eventRows || []) as SweetEvent[]) eventMap.set(e.id, e);

  return rsvps
    .map((rsvp) => {
      const event = eventMap.get(rsvp.event_id);
      return event ? { event, rsvp } : null;
    })
    .filter((r): r is EventWithRsvp => r !== null)
    .sort((a, b) => +new Date(a.event.starts_at) - +new Date(b.event.starts_at));
}

/**
 * Look up a pending invitation by token (used on the /events/rsvp/[token]
 * accept flow — like band invites).
 */
export async function getRsvpByToken(
  token: string,
  client?: SupabaseClient,
): Promise<(EventRsvp & { event: SweetEvent | null }) | null> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('event_rsvps')
    .select('*, event:events(*)')
    .eq('token', token)
    .maybeSingle();
  return (data as (EventRsvp & { event: SweetEvent | null }) | null) ?? null;
}

/**
 * Pending invites/requests addressed to an email (case-insensitive). Powers
 * the "pending event invitations" banner on the Artist Hub when someone was
 * invited by email before creating their account.
 */
export async function getPendingEventInvitesForEmail(
  email: string,
  client?: SupabaseClient,
): Promise<(EventRsvp & { event: SweetEvent })[]> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('event_rsvps')
    .select('*, event:events(*)')
    .ilike('invited_email', email)
    .eq('status', 'invited')
    .is('responded_at', null)
    .order('created_at', { ascending: false });
  const rows = (data || []) as (EventRsvp & { event: SweetEvent | null })[];
  return rows.filter((r): r is EventRsvp & { event: SweetEvent } => !!r.event);
}

// ============================================================
// Admin listing
// ============================================================

/**
 * All events — admin view includes cancelled + hidden. Ordered by start time
 * descending so upcoming shows at top, past below.
 */
export async function getAllEventsForAdmin(
  client?: SupabaseClient,
): Promise<SweetEvent[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('starts_at', { ascending: false });
  if (error) {
    console.error('[events] getAllEventsForAdmin error:', error);
    return [];
  }
  return (data || []) as SweetEvent[];
}

// ============================================================
// Slug generation
// ============================================================

/**
 * Reserved slugs under /events/. Must not collide with static App Router
 * segments. Keep in sync when adding new static routes under app/events/.
 */
const RESERVED_EVENT_SLUGS = new Set<string>([
  'rsvp',   // /events/rsvp/[token] — invitation accept route
  'new',
  'edit',
  'admin',
  'api',
]);

export async function uniqueEventSlug(
  base: string,
  client?: SupabaseClient,
): Promise<string> {
  const supabase = client || createServiceClient();
  const safeBase = base || 'event';
  let candidate = safeBase;
  let suffix = 1;

  while (true) {
    if (RESERVED_EVENT_SLUGS.has(candidate)) {
      suffix += 1;
      candidate = `${safeBase}-${suffix}`;
      continue;
    }
    const { data } = await supabase
      .from('events')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    suffix += 1;
    candidate = `${safeBase}-${suffix}`;
  }
}

// ============================================================
// Helpers for consumers
// ============================================================

/**
 * Given a list of status values the caller is interested in, filter RSVPs.
 * Pure convenience wrapper — avoids exporting an `array.includes(r.status)`
 * predicate at every call site.
 */
export function filterRsvpsByStatus(
  rsvps: EventRsvp[],
  statuses: EventRsvpStatus[],
): EventRsvp[] {
  const set = new Set(statuses);
  return rsvps.filter((r) => set.has(r.status));
}
