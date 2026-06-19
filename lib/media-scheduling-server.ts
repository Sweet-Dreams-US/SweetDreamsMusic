// lib/media-scheduling-server.ts
//
// Server-only helpers for media session scheduling. The conflict check
// is the high-value primitive here: given a proposed session window +
// engineer, find every existing commitment that would conflict by
// querying both `bookings` (studio sessions) and `media_session_bookings`
// (other media work).
//
// Boundary: imports the service Supabase client. NEVER import this from
// a client component.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase/server';
import { ENGINEERS } from './constants';
import {
  type BusyWindow,
  type MediaSessionBooking,
  type ProposedSession,
  findOverlap,
  formatWindowLabel,
} from './media-scheduling';

// ============================================================
// Engineer identity bridge
// ============================================================

/**
 * Resolve the engineer constant entry (which has email, display name,
 * studio assignments) by matching their auth.users.id. Returns null if
 * the user_id doesn't map to a known engineer in our roster — admin
 * users won't, for example.
 *
 * Caches one round-trip by passing the `client` from the caller's
 * existing supabase instance when available.
 */
export async function getEngineerByUserId(
  userId: string,
  client?: SupabaseClient,
): Promise<{ name: string; email: string; userId: string } | null> {
  const supabase = client || createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle();
  const email = (profile as { email?: string } | null)?.email;
  if (!email) return null;
  const match = ENGINEERS.find(
    (e) => e.email.toLowerCase() === email.toLowerCase(),
  );
  if (!match) return null;
  return { name: match.name, email: match.email, userId };
}

/**
 * Resolve an engineer's auth.users.id from their roster name. Used by the
 * scheduler form which lets the buyer pick an engineer by display name —
 * we look up their email in `ENGINEERS`, then their user_id via profiles.
 *
 * Returns null if the engineer isn't onboarded (no profile row matching
 * their email yet). Admin should never see this in practice; the scheduler
 * only lists engineers who *are* in the roster.
 */
export async function getEngineerUserIdByName(
  engineerName: string,
  client?: SupabaseClient,
): Promise<string | null> {
  const match = ENGINEERS.find((e) => e.name === engineerName);
  if (!match) return null;
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike('email', match.email)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

// ============================================================
// Conflict-check — the heart of the scheduling layer
// ============================================================

/**
 * Build the busy-window list for an engineer over a date window. Queries
 * both:
 *
 *   1. `bookings` — existing studio sessions where the engineer is
 *      assigned (`engineer_name`) OR has been requested but not yet
 *      claimed (`requested_engineer` with no engineer_name yet, treated
 *      as a soft hold). Cancelled/completed are excluded.
 *
 *   2. `media_session_bookings` — other media sessions in this hub where
 *      the engineer is the FK owner. Cancelled status excluded.
 *
 * Time window: callers pass `[from, to]` as ISO timestamps. Anything
 * partially overlapping that window is included — the consumer's
 * `findOverlap` handles the actual overlap test against the *proposed*
 * window. We over-fetch within the day to keep the query cheap.
 */
export async function getEngineerBusyWindows(
  args: {
    engineerId: string;
    from: string; // ISO
    to: string;   // ISO
  },
  client?: SupabaseClient,
): Promise<BusyWindow[]> {
  const supabase = client || createServiceClient();
  const out: BusyWindow[] = [];

  // Resolve engineer name for studio booking lookups (bookings table uses
  // name, not user_id).
  const engineer = await getEngineerByUserId(args.engineerId, supabase);

  // 1. Existing studio bookings for this engineer's name.
  if (engineer) {
    const { data: studioRows, error: studioErr } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, duration, room, engineer_name, requested_engineer, status')
      .or(
        `engineer_name.eq.${engineer.name},and(requested_engineer.eq.${engineer.name},engineer_name.is.null)`,
      )
      .lt('start_time', args.to)
      .gt('end_time', args.from)
      .not('status', 'in', '(cancelled,completed)');
    if (studioErr) {
      console.error('[media-scheduling] studio busy query error:', studioErr);
    } else {
      for (const row of (studioRows || []) as Array<{
        start_time: string;
        end_time: string;
        room: string;
      }>) {
        out.push({
          startsAt: row.start_time,
          endsAt: row.end_time,
          source: 'studio_booking',
          label: formatWindowLabel(
            row.start_time,
            row.end_time,
            `Studio session (${row.room.replace('_', ' ')})`,
          ),
        });
      }
    }
  }

  // 2. Existing media sessions for this engineer.
  const { data: mediaRows, error: mediaErr } = await supabase
    .from('media_session_bookings')
    .select('starts_at, ends_at, session_kind, location, status')
    .eq('engineer_id', args.engineerId)
    .lt('starts_at', args.to)
    .gt('ends_at', args.from)
    .neq('status', 'cancelled');
  if (mediaErr) {
    console.error('[media-scheduling] media busy query error:', mediaErr);
  } else {
    for (const row of (mediaRows || []) as Array<{
      starts_at: string;
      ends_at: string;
      session_kind: string;
      location: string;
    }>) {
      out.push({
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        source: 'media_session',
        label: formatWindowLabel(
          row.starts_at,
          row.ends_at,
          `${row.session_kind} (${row.location})`,
        ),
      });
    }
  }

  return out;
}

/**
 * High-level check: is the proposed session free for this engineer? Returns
 * the FIRST conflicting busy window, or null when the slot is open. The API
 * surfaces this conflict in the error response so the form can highlight it.
 *
 * Window we look at = proposed window padded by 1 day on each side. That's
 * more than enough to catch overlapping multi-hour sessions and keeps the
 * Postgres query cheap.
 */
export async function checkMediaSessionConflict(
  proposed: ProposedSession,
  client?: SupabaseClient,
): Promise<BusyWindow | null> {
  const start = new Date(proposed.startsAt);
  const end = new Date(proposed.endsAt);
  const dayMs = 24 * 60 * 60 * 1000;
  const fromIso = new Date(start.getTime() - dayMs).toISOString();
  const toIso = new Date(end.getTime() + dayMs).toISOString();

  const busy = await getEngineerBusyWindows(
    { engineerId: proposed.engineerId, from: fromIso, to: toIso },
    client,
  );
  return findOverlap(proposed, busy);
}

// ============================================================
// Media-manager conflict check (Phase 5)
// ============================================================

/**
 * Busy windows for a MEDIA MANAGER (not an engineer). A media manager's
 * commitments are entirely within media_session_bookings (they don't appear
 * on the studio `bookings` table), so this only queries their assigned media
 * sessions. Used to prevent a manager double-booking themselves when they
 * Accept an incoming request.
 */
export async function getMediaManagerBusyWindows(
  args: { managerId: string; from: string; to: string },
  client?: SupabaseClient,
): Promise<BusyWindow[]> {
  const supabase = client || createServiceClient();
  const out: BusyWindow[] = [];

  const { data: rows, error } = await supabase
    .from('media_session_bookings')
    .select('starts_at, ends_at, session_kind, location, status')
    .eq('media_manager_id', args.managerId)
    .lt('starts_at', args.to)
    .gt('ends_at', args.from)
    .not('status', 'in', '(cancelled,superseded)');
  if (error) {
    console.error('[media-scheduling] manager busy query error:', error);
    return out;
  }
  for (const row of (rows || []) as Array<{
    starts_at: string;
    ends_at: string;
    session_kind: string;
    location: string;
  }>) {
    out.push({
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      source: 'media_session',
      label: formatWindowLabel(row.starts_at, row.ends_at, `${row.session_kind} (${row.location})`),
    });
  }
  return out;
}

/** First conflicting window for a manager taking on a proposed slot, or null. */
export async function checkMediaManagerConflict(
  args: { managerId: string; startsAt: string; endsAt: string },
  client?: SupabaseClient,
): Promise<BusyWindow | null> {
  const start = new Date(args.startsAt);
  const end = new Date(args.endsAt);
  const dayMs = 24 * 60 * 60 * 1000;
  const busy = await getMediaManagerBusyWindows(
    {
      managerId: args.managerId,
      from: new Date(start.getTime() - dayMs).toISOString(),
      to: new Date(end.getTime() + dayMs).toISOString(),
    },
    client,
  );
  return findOverlap({ startsAt: args.startsAt, endsAt: args.endsAt }, busy);
}

// ============================================================
// Reads for the UI
// ============================================================

/**
 * All scheduled media sessions for a parent media booking. Used by the
 * order detail page to show the "your scheduled sessions" panel under the
 * "what you bought" panel.
 */
export async function getSessionsForBooking(
  bookingId: string,
  client?: SupabaseClient,
): Promise<MediaSessionBooking[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('media_session_bookings')
    .select('*')
    .eq('parent_booking_id', bookingId)
    .order('starts_at', { ascending: true });
  if (error) {
    console.error('[media-scheduling] getSessionsForBooking error:', error);
    return [];
  }
  return (data || []) as MediaSessionBooking[];
}

/**
 * All media bookings for a user — both personal and band-attached. Used by
 * `/dashboard/media/orders`. Status filter excludes cancelled rows so the
 * list stays focused on active orders.
 */
export async function getMediaBookingsForOwner(
  args: { userId: string; bandIds: string[] },
  client?: SupabaseClient,
): Promise<Array<{
  id: string;
  offering_id: string;
  user_id: string;
  band_id: string | null;
  status: string;
  configured_components: unknown | null;
  final_price_cents: number;
  created_at: string;
}>> {
  const supabase = client || createServiceClient();

  // Build the OR filter for "this user OR any of their bands". Band ids
  // are passed in by the caller so we don't have to re-query band_members
  // here — the dashboard usually already has them.
  let q = supabase
    .from('media_bookings')
    .select(
      'id, offering_id, user_id, band_id, status, configured_components, final_price_cents, created_at',
    )
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });

  if (args.bandIds.length > 0) {
    const bandList = args.bandIds.map((b) => `band_id.eq.${b}`).join(',');
    q = q.or(`user_id.eq.${args.userId},${bandList}`);
  } else {
    q = q.eq('user_id', args.userId);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[media-scheduling] getMediaBookingsForOwner error:', error);
    return [];
  }
  return data || [];
}

/**
 * Media bookings that are AWAITING THE ARTIST'S SIGNATURE — i.e. the manager
 * has agreed (`manager_agreed_at` set) but the artist hasn't (`contract_agreed_at`
 * null), and the order isn't cancelled. These are the contracts an artist needs
 * to find + sign on the order detail page (MediaContractSchedule handles signing).
 *
 * Includes both personal and band-attached bookings, resolved the same way as
 * `getMediaBookingsForOwner`. Joins the offering title so callers can render a
 * meaningful "sign your contract for X" prompt without an extra round-trip.
 */
export async function getContractsAwaitingSignature(
  args: { userId: string; bandIds: string[] },
  client?: SupabaseClient,
): Promise<Array<{
  id: string;
  offering_id: string;
  offering_title: string;
  final_price_cents: number;
}>> {
  const supabase = client || createServiceClient();

  let q = supabase
    .from('media_bookings')
    .select('id, offering_id, final_price_cents, media_offerings(title)')
    .not('manager_agreed_at', 'is', null)
    .is('contract_agreed_at', null)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });

  if (args.bandIds.length > 0) {
    const bandList = args.bandIds.map((b) => `band_id.eq.${b}`).join(',');
    q = q.or(`user_id.eq.${args.userId},${bandList}`);
  } else {
    q = q.eq('user_id', args.userId);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[media-scheduling] getContractsAwaitingSignature error:', error);
    return [];
  }

  return ((data || []) as Array<{
    id: string;
    offering_id: string;
    final_price_cents: number;
    media_offerings: { title: string } | { title: string }[] | null;
  }>).map((row) => {
    const off = Array.isArray(row.media_offerings)
      ? row.media_offerings[0]
      : row.media_offerings;
    return {
      id: row.id,
      offering_id: row.offering_id,
      offering_title: off?.title ?? 'Media order',
      final_price_cents: row.final_price_cents,
    };
  });
}
