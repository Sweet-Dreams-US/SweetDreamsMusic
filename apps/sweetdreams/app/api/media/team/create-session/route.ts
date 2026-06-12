// app/api/media/team/create-session/route.ts
//
// Team-initiated media session (Phase 7) — the media analog of an engineer
// creating a session invite. A media manager picks an existing client + a
// date/time + kind + the vision, and it lands as a CONFIRMED, manager-assigned
// media_session_bookings row (status='scheduled'). The client sees it in their
// Artist Hub and gets an email.
//
// Differs from the artist request flow: no media_credit is consumed (these are
// team-comped / scoped-separately shoots) and the 48h lead rule is NOT enforced
// (the team is initiating + confirming their own availability). Payment, when
// applicable, runs through the existing media booking/package/charge endpoints
// the team now has access to (Phase 5 re-gate).

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { checkMediaManagerConflict } from '@/lib/media-scheduling-server';
import { studioInputToUtcISO, fmtStampDateTime } from '@/lib/studio-time';
import { SESSION_KIND_LABELS, type MediaSessionKind } from '@/lib/media-scheduling';
import { SITE_URL } from '@/lib/constants';
import { emailIdentity } from '@/lib/email';

const resend = new Resend(process.env.RESEND_API_KEY);
const VALID_KINDS: MediaSessionKind[] = ['video', 'photo', 'storyboard', 'marketing-meeting', 'planning_call', 'other'];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const clientUserId = body.client_user_id ? String(body.client_user_id) : null;
  const clientEmail = body.client_email ? String(body.client_email).trim() : null;
  const date = String(body.date || '').trim();
  const time = String(body.start_time || '').trim();
  const durationHours = Math.max(0.5, Math.min(12, Number(body.duration_hours) || 2));
  const sessionKind = String(body.session_kind || '') as MediaSessionKind;
  const location = body.location === 'external' ? 'external' : 'studio';
  const externalText = body.external_location_text ? String(body.external_location_text).trim() : null;
  const vision = body.vision ? String(body.vision).trim() : '';

  if (!clientEmail) return NextResponse.json({ error: 'Pick a client' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: 'Pick a valid date and time' }, { status: 400 });
  }
  if (!VALID_KINDS.includes(sessionKind)) {
    return NextResponse.json({ error: 'Pick a session type' }, { status: 400 });
  }

  const startsAt = studioInputToUtcISO(`${date}T${time}`);
  if (!startsAt) return NextResponse.json({ error: 'Invalid date/time' }, { status: 400 });
  const endsAt = new Date(new Date(startsAt).getTime() + durationHours * 3_600_000).toISOString();

  const service = createServiceClient();

  // Conflict check against THIS manager's other media sessions.
  const conflict = await checkMediaManagerConflict({ managerId: user.id, startsAt, endsAt }, service);
  if (conflict) {
    return NextResponse.json({ error: `You're already booked then: ${conflict.label}` }, { status: 409 });
  }

  const { data: row, error } = await service
    .from('media_session_bookings')
    .insert({
      parent_booking_id: null,
      media_credit_id: null,
      requested_by: clientUserId,
      media_manager_id: user.id,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      vision: vision || null,
      starts_at: startsAt,
      ends_at: endsAt,
      location,
      external_location_text: location === 'external' ? externalText : null,
      engineer_id: null,
      session_kind: sessionKind,
      status: 'scheduled',
      notes: `Team-created by ${user.email} for ${clientEmail}.`,
    })
    .select('id')
    .single();
  if (error || !row) {
    console.error('[media/team/create-session] insert error:', error);
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 });
  }

  // Notify the client.
  const whenLabel = fmtStampDateTime(startsAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  try {
    await resend.emails.send({
      from: await emailIdentity(),
      to: [clientEmail],
      subject: `Your ${SESSION_KIND_LABELS[sessionKind]} is booked — ${whenLabel}`,
      html: `
        <h2>You're on the calendar 🎬</h2>
        <p>The Sweet Dreams media team scheduled a <strong>${SESSION_KIND_LABELS[sessionKind]}</strong> for you on <strong>${whenLabel}</strong> (Fort Wayne).</p>
        <p>Location: ${location === 'external' ? (externalText || 'On location') : 'At the studio'}.</p>
        ${vision ? `<p>Notes: ${vision.replace(/</g, '&lt;')}</p>` : ''}
        <p><a href="${SITE_URL}/dashboard/hub?tab=media">View in your Artist Hub</a></p>
      `,
    });
  } catch (e) {
    console.error('[media/team/create-session] email error:', e);
  }

  return NextResponse.json({ ok: true, session_id: (row as { id: string }).id });
}
