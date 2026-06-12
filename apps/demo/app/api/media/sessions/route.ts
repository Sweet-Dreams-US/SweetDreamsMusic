// app/api/media/sessions/route.ts
//
// Media session scheduling. Two operations:
//   - POST: schedule a new media_session_bookings row, with conflict
//     check against existing studio bookings and other media sessions.
//   - GET: list sessions for a parent media booking (used by the order
//     detail page's sessions panel).
//
// Trust model:
//   - User must own the parent media_bookings row (or be a member of the
//     band it's attached to).
//   - Engineer is identified by *name* (display string from ENGINEERS),
//     resolved server-side to a user_id. We never trust a client-supplied
//     user_id.
//   - The conflict check runs against the database, not metadata. A bad
//     actor sending overlapping times gets a 409 from the server, never
//     a row insert.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { ENGINEERS } from '@/lib/constants';
import { getUserBands } from '@/lib/bands-server';
import {
  type MediaSessionKind,
  type MediaSessionLocation,
  validateProposed,
  SESSION_KIND_LABELS,
} from '@/lib/media-scheduling';
import {
  checkMediaSessionConflict,
  getEngineerUserIdByName,
  getSessionsForBooking,
} from '@/lib/media-scheduling-server';
import {
  sendMediaSessionScheduled,
  sendMediaSessionEngineerAlert,
} from '@/lib/email';

const VALID_KINDS: MediaSessionKind[] = [
  'video',
  'photo',
  'recording',
  'mixing',
  'storyboard',
  'marketing-meeting',
  'other',
];
const VALID_LOCATIONS: MediaSessionLocation[] = ['studio', 'external'];

// ============================================================
// POST — schedule a new session
// ============================================================
export async function POST(request: NextRequest) {
  // Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parentBookingId = String(body.parent_booking_id || '');
  const startsAt = String(body.starts_at || '');
  const endsAt = String(body.ends_at || '');
  const engineerName = String(body.engineer_name || '');
  const location = String(body.location || '') as MediaSessionLocation;
  const externalLocationText = body.external_location_text
    ? String(body.external_location_text).trim()
    : null;
  const sessionKind = String(body.session_kind || 'video') as MediaSessionKind;
  const notes = body.notes ? String(body.notes).trim() : null;

  if (!parentBookingId) {
    return NextResponse.json({ error: 'parent_booking_id required' }, { status: 400 });
  }
  if (!VALID_KINDS.includes(sessionKind)) {
    return NextResponse.json({ error: 'Invalid session_kind' }, { status: 400 });
  }
  if (!VALID_LOCATIONS.includes(location)) {
    return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
  }
  if (location === 'external' && !externalLocationText) {
    return NextResponse.json(
      { error: 'External shoots need a location description' },
      { status: 400 },
    );
  }

  // Resolve engineer name → user_id. We don't accept user_id from the
  // client — they pick from a known list of names.
  const engineerEntry = ENGINEERS.find((e) => e.name === engineerName);
  if (!engineerEntry) {
    return NextResponse.json({ error: 'Unknown engineer' }, { status: 400 });
  }
  const engineerUserId = await getEngineerUserIdByName(engineerName);
  if (!engineerUserId) {
    return NextResponse.json(
      { error: 'Engineer is not onboarded yet — try a different engineer.' },
      { status: 400 },
    );
  }

  // Validate the proposed window shape
  const validationError = validateProposed({
    startsAt,
    endsAt,
    engineerId: engineerUserId,
  });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Validate parent booking ownership. User must own it (user_id match) OR
  // be a member of the attached band. We use the service client for this
  // read so RLS doesn't second-guess the ownership check we're doing
  // explicitly.
  const service = createServiceClient();
  const { data: parent, error: parentErr } = await service
    .from('media_bookings')
    .select('id, user_id, band_id, status')
    .eq('id', parentBookingId)
    .maybeSingle();

  if (parentErr || !parent) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  const parentRow = parent as {
    id: string;
    user_id: string;
    band_id: string | null;
    status: string;
  };

  if (parentRow.user_id !== user.id) {
    if (parentRow.band_id) {
      const memberships = await getUserBands(user.id);
      const inBand = memberships.some((m) => m.band_id === parentRow.band_id);
      if (!inBand) {
        return NextResponse.json({ error: 'Not your order' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Not your order' }, { status: 403 });
    }
  }

  // Inquiry rows can't be scheduled — they need to be paid first.
  if (parentRow.status === 'inquiry' || parentRow.status === 'cancelled') {
    return NextResponse.json(
      { error: 'This order is not in a schedulable state — pay or contact support' },
      { status: 400 },
    );
  }

  // Conflict check
  const conflict = await checkMediaSessionConflict(
    {
      startsAt,
      endsAt,
      engineerId: engineerUserId,
      location,
    },
    service,
  );
  if (conflict) {
    return NextResponse.json(
      {
        error: `${engineerEntry.name} has a conflict: ${conflict.label}`,
        conflict,
      },
      { status: 409 },
    );
  }

  // Insert the session row
  const { data: newSession, error: insertErr } = await service
    .from('media_session_bookings')
    .insert({
      parent_booking_id: parentBookingId,
      starts_at: startsAt,
      ends_at: endsAt,
      location,
      external_location_text: externalLocationText,
      engineer_id: engineerUserId,
      session_kind: sessionKind,
      status: 'scheduled',
      notes,
    })
    .select('id, starts_at, ends_at, session_kind, location, external_location_text')
    .single();

  if (insertErr || !newSession) {
    console.error('[media/sessions] insert error:', insertErr);
    return NextResponse.json({ error: 'Could not save session' }, { status: 500 });
  }

  // Promote parent booking to 'scheduled' if this is the first session.
  // We don't go past 'scheduled' here — production state advances when an
  // admin marks delivery, not on schedule.
  if (parentRow.status === 'deposited') {
    await service
      .from('media_bookings')
      .update({ status: 'scheduled' })
      .eq('id', parentBookingId);
  }

  // Buyer profile for emails
  const { data: buyerProfile } = await service
    .from('profiles')
    .select('display_name, email')
    .eq('user_id', user.id)
    .maybeSingle();
  const buyerName =
    (buyerProfile as { display_name?: string; email?: string } | null)?.display_name ||
    user.email.split('@')[0];

  // Offering title for the email
  const { data: offeringRow } = await service
    .from('media_offerings')
    .select('title')
    .eq('id', (await service.from('media_bookings').select('offering_id').eq('id', parentBookingId).single()).data?.offering_id ?? '')
    .maybeSingle();
  const offeringTitle = (offeringRow as { title?: string } | null)?.title || 'your media order';

  // Fire-and-forget emails — failure does not roll back the schedule.
  try {
    await sendMediaSessionScheduled(user.email, {
      buyerName,
      offeringTitle,
      sessionKindLabel: SESSION_KIND_LABELS[sessionKind],
      startsAt,
      endsAt,
      location,
      externalLocationText,
      engineerName: engineerEntry.name,
      bookingId: parentBookingId,
    });
  } catch (e) {
    console.error('[media/sessions] buyer email error:', e);
  }
  try {
    await sendMediaSessionEngineerAlert(engineerEntry.email, {
      engineerName: engineerEntry.displayName,
      buyerName,
      offeringTitle,
      sessionKindLabel: SESSION_KIND_LABELS[sessionKind],
      startsAt,
      endsAt,
      location,
      externalLocationText,
      notes,
    });
  } catch (e) {
    console.error('[media/sessions] engineer email error:', e);
  }

  return NextResponse.json({ session: newSession });
}

// ============================================================
// GET — list sessions for a parent booking
// ============================================================
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parentBookingId = searchParams.get('parent_booking_id');
  if (!parentBookingId) {
    return NextResponse.json({ error: 'parent_booking_id required' }, { status: 400 });
  }

  // Ownership check before returning data
  const service = createServiceClient();
  const { data: parent } = await service
    .from('media_bookings')
    .select('user_id, band_id')
    .eq('id', parentBookingId)
    .maybeSingle();
  const parentRow = parent as { user_id: string; band_id: string | null } | null;
  if (!parentRow) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  if (parentRow.user_id !== user.id) {
    if (parentRow.band_id) {
      const memberships = await getUserBands(user.id);
      const inBand = memberships.some((m) => m.band_id === parentRow.band_id);
      if (!inBand) {
        return NextResponse.json({ error: 'Not your order' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Not your order' }, { status: 403 });
    }
  }

  const sessions = await getSessionsForBooking(parentBookingId, service);
  return NextResponse.json({ sessions });
}
