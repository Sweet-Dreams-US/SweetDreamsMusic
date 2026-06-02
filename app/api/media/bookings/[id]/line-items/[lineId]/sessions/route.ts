// app/api/media/bookings/[id]/line-items/[lineId]/sessions/route.ts
//
// Round 8d: per-line-item scheduling. POST creates a proposed session
// row attached to a line item; either side can propose first. The other
// side approves (POST /sessions/[sessionId]/approve) or counter-proposes
// (POST /sessions/[sessionId]/counter), and the cycle continues until
// both agree.
//
// GET returns all (non-cancelled, non-superseded) sessions for the line
// item — used by the SessionScheduler UI.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { fmtStampDateTime } from '@/lib/studio-time';

const VALID_KINDS = [
  'planning_call',
  'filming_external',
  'design_meeting',
  'mixing_session',
  'recording_session',
  'photo_shoot',
  'video',
  'other',
] as const;

const VALID_LOCATIONS = ['studio', 'external'] as const;

async function resolveRole(
  service: ReturnType<typeof createServiceClient>,
  user: { id: string; role: string },
  bookingId: string,
): Promise<'admin' | 'buyer' | 'engineer' | null> {
  if (user.role === 'admin') return 'admin';
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('user_id, band_id')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bookingRow as { user_id: string; band_id: string | null } | null;
  if (!b) return null;
  if (b.user_id === user.id) return 'buyer';
  if (b.band_id) {
    const { data: m } = await service
      .from('band_members')
      .select('id')
      .eq('band_id', b.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (m) return 'buyer';
  }
  const { data: s } = await service
    .from('media_session_bookings')
    .select('id')
    .eq('parent_booking_id', bookingId)
    .eq('engineer_id', user.id)
    .limit(1)
    .maybeSingle();
  return s ? 'engineer' : null;
}

// GET — list all proposals + scheduled sessions on this line item.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: bookingId, lineId } = await params;
  const service = createServiceClient();
  const role = await resolveRole(service, user, bookingId);
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: sessions, error } = await service
    .from('media_session_bookings')
    .select('id, line_item_id, parent_booking_id, starts_at, ends_at, location, external_location_text, engineer_id, session_kind, status, proposed_by, proposed_at, approved_at, supersedes_id, notes')
    .eq('line_item_id', lineId)
    .neq('status', 'superseded')
    .order('starts_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ role, sessions: sessions ?? [] });
}

// POST — propose a new date for this line item.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: bookingId, lineId } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const startsAt = typeof body.starts_at === 'string' ? body.starts_at : '';
  const endsAt = typeof body.ends_at === 'string' ? body.ends_at : '';
  const location = typeof body.location === 'string' ? body.location : 'studio';
  const externalText = typeof body.external_location_text === 'string'
    ? body.external_location_text.trim() : null;
  const sessionKind = typeof body.session_kind === 'string' ? body.session_kind : 'other';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
  const supersedesId = typeof body.supersedes_id === 'string' ? body.supersedes_id : null;

  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: 'starts_at and ends_at required (ISO datetime)' }, { status: 400 });
  }
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return NextResponse.json({ error: 'starts_at must be before ends_at' }, { status: 400 });
  }
  if (!VALID_LOCATIONS.includes(location as (typeof VALID_LOCATIONS)[number])) {
    return NextResponse.json({ error: 'location must be studio or external' }, { status: 400 });
  }
  if (location === 'external' && !externalText) {
    return NextResponse.json({ error: 'external_location_text required when location=external' }, { status: 400 });
  }
  if (!VALID_KINDS.includes(sessionKind as (typeof VALID_KINDS)[number])) {
    return NextResponse.json({ error: `session_kind must be one of ${VALID_KINDS.join(', ')}` }, { status: 400 });
  }

  const service = createServiceClient();
  const role = await resolveRole(service, user, bookingId);
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (role === 'engineer') {
    return NextResponse.json({ error: 'Engineers can use the chat to coordinate; only admin/buyer propose dates here.' }, { status: 403 });
  }
  const proposedBy: 'admin' | 'buyer' = role;

  // Verify the line item belongs to this booking.
  const { data: lineRow } = await service
    .from('media_booking_line_items')
    .select('id, package_id, label')
    .eq('id', lineId)
    .maybeSingle();
  const line = lineRow as { id: string; package_id: string; label: string } | null;
  if (!line) return NextResponse.json({ error: 'Line item not found' }, { status: 404 });
  const { data: pkgRow } = await service
    .from('media_booking_packages')
    .select('booking_id')
    .eq('id', line.package_id)
    .maybeSingle();
  const pkg = pkgRow as { booking_id: string } | null;
  if (!pkg || pkg.booking_id !== bookingId) {
    return NextResponse.json({ error: 'Line item does not belong to this booking' }, { status: 400 });
  }

  // If this proposal supersedes an earlier one, mark that one superseded.
  if (supersedesId) {
    await service
      .from('media_session_bookings')
      .update({ status: 'superseded' })
      .eq('id', supersedesId)
      .eq('line_item_id', lineId);
  }

  const { data: created, error } = await service
    .from('media_session_bookings')
    .insert({
      parent_booking_id: bookingId,
      line_item_id: lineId,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      location,
      external_location_text: location === 'external' ? externalText : null,
      session_kind: sessionKind,
      status: 'proposed',
      proposed_by: proposedBy,
      proposed_at: new Date().toISOString(),
      supersedes_id: supersedesId,
      notes,
    })
    .select('id, starts_at, ends_at, status, proposed_by')
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: `Could not propose session: ${error?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  await service.from('media_booking_audit_log').insert({
    booking_id: bookingId,
    action: 'session_proposed',
    performed_by: user.email,
    details: {
      session_id: (created as { id: string }).id,
      line_item_id: lineId,
      line_label: line.label,
      starts_at: startsAt,
      ends_at: endsAt,
      proposed_by: proposedBy,
      session_kind: sessionKind,
      location,
      supersedes_id: supersedesId,
    },
  });

  // Post a system message into the chat so the other side gets a digest.
  const startLabel = fmtStampDateTime(startsAt, { weekday: 'short' });
  const proposerName = user.profile?.display_name ?? user.email.split('@')[0];
  const verb = supersedesId ? 'counter-proposed' : 'proposed';
  await service.from('media_booking_messages').insert({
    booking_id: bookingId,
    author_user_id: null,
    author_role: 'system',
    body: `${proposerName} ${verb} ${startLabel} for ${line.label}. The other side approves or counter-proposes here.`,
    attachments: [],
  });

  // Email digest — same helper Round 8b uses, framed as a buyer/admin
  // message so the right recipient gets the bump.
  try {
    const { sendNewMediaMessageNotification } = await import('@/lib/email');
    await sendNewMediaMessageNotification({
      bookingId,
      authorRole: proposedBy,
      authorName: proposerName,
      bodyPreview: `Proposed ${startLabel} for ${line.label}. Approve or counter-propose on the order page.`,
      hasAttachments: false,
    });
  } catch (e) { console.error('[session-propose] notification failed:', e); }

  return NextResponse.json({ ok: true, session: created });
}
