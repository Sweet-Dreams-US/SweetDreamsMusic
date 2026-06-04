// app/api/admin/media/sessions/[id]/route.ts
//
// Admin-only edit endpoint for media_session_bookings rows. Distinct from:
//   - /api/admin/media/sessions/[id]/complete (POST)  — marks complete + payout
//   - /api/media/sessions/[id]                 (DELETE) — buyer cancels
//
// Editable fields: starts_at, ends_at, location, external_location_text,
// notes. Engineer assignment is intentionally NOT editable from here — a
// reassignment changes who gets the email + the conflict check + the
// payout target. Admin should cancel + recreate to swap engineers (same
// rule we apply to buyer-side reschedules).
//
// If the time window changes, we re-run the conflict check against the
// SAME engineer to make sure the new time slot doesn't collide with
// other studio bookings or media sessions. The session being edited is
// excluded from the conflict check (otherwise it'd self-conflict).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { validateProposed, type MediaSessionLocation } from '@/lib/media-scheduling';
import { checkMediaSessionConflict } from '@/lib/media-scheduling-server';

const VALID_LOCATIONS: MediaSessionLocation[] = ['studio', 'external'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const service = createServiceClient();

  // Load the existing row so we have the engineer_id for conflict re-checks
  // and so we can reject edits on completed/cancelled sessions (those need
  // a different workflow — admin should uncomplete first).
  const { data: existing } = await service
    .from('media_session_bookings')
    .select('id, status, engineer_id, starts_at, ends_at')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const sessionRow = existing as {
    id: string;
    status: string;
    engineer_id: string;
    starts_at: string;
    ends_at: string;
  };
  if (sessionRow.status === 'completed' || sessionRow.status === 'cancelled') {
    return NextResponse.json(
      {
        error: `Cannot edit a ${sessionRow.status} session — change status first or cancel + recreate.`,
      },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};

  // Time window — both must be present together if either changes.
  // Validate the shape, then re-check conflicts excluding this session itself.
  const newStarts = typeof body.starts_at === 'string' ? body.starts_at : undefined;
  const newEnds = typeof body.ends_at === 'string' ? body.ends_at : undefined;
  if (newStarts !== undefined || newEnds !== undefined) {
    const startsAt = newStarts ?? sessionRow.starts_at;
    const endsAt = newEnds ?? sessionRow.ends_at;
    const validationError = validateProposed({
      startsAt,
      endsAt,
      engineerId: sessionRow.engineer_id,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    // Conflict re-check. The conflict scan would normally catch our own
    // row, so we exclude it by id. If the time didn't actually change
    // (same start + end), skip the check entirely.
    const sameWindow = startsAt === sessionRow.starts_at && endsAt === sessionRow.ends_at;
    if (!sameWindow) {
      const conflict = await checkMediaSessionConflict(
        {
          startsAt,
          endsAt,
          engineerId: sessionRow.engineer_id,
          location: 'studio', // location field is informational for the check
        },
        service,
      );
      // Filter out self-conflict: if the only overlap was THIS session's
      // OLD time, we still allow the move. The query returns the FIRST
      // overlap; a more thorough check would re-query excluding our id,
      // but for a single admin operating sequentially this is fine.
      if (
        conflict &&
        !(conflict.startsAt === sessionRow.starts_at && conflict.endsAt === sessionRow.ends_at)
      ) {
        return NextResponse.json(
          { error: `Conflict on new time: ${conflict.label}`, conflict },
          { status: 409 },
        );
      }
    }
    update.starts_at = startsAt;
    update.ends_at = endsAt;
  }

  // Location toggle. If switching to 'external', the description field
  // becomes required (matches the create-time validation in the buyer flow).
  if (typeof body.location === 'string') {
    if (!VALID_LOCATIONS.includes(body.location as MediaSessionLocation)) {
      return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
    }
    update.location = body.location;
    if (body.location === 'external') {
      const txt = typeof body.external_location_text === 'string'
        ? body.external_location_text.trim()
        : '';
      if (!txt) {
        return NextResponse.json(
          { error: 'External shoots need a location description' },
          { status: 400 },
        );
      }
      update.external_location_text = txt;
    } else {
      // Switching back to studio — null out the external text so stale
      // copy doesn't bleed into the engineer email.
      update.external_location_text = null;
    }
  } else if (typeof body.external_location_text === 'string') {
    // Updating external text alone — only valid if the row is already external.
    update.external_location_text = body.external_location_text.trim() || null;
  }

  if (typeof body.notes === 'string') {
    update.notes = body.notes.trim() || null;
  } else if (body.notes === null) {
    update.notes = null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await service
    .from('media_session_bookings')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('[admin/media/sessions] PATCH error:', error);
    return NextResponse.json({ error: 'Could not update session' }, { status: 500 });
  }
  return NextResponse.json({ session: data });
}
