import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { sendEventRsvpDecision } from '@/lib/email';

/**
 * PATCH /api/admin/events/[id]/rsvps/[rsvpId] — update a single RSVP row.
 *
 * Used by admin to:
 *   - Approve a 'requested' row (body: { status: 'going' })
 *   - Deny a 'requested' row (body: { status: 'not_going', declineReason? })
 *   - Manually update any RSVP status (rare — emergency corrections)
 *
 * When a requested → going transition happens, we email the requester the
 * "you're in" decision. When requested → not_going, we email the polite
 * "can't fit you in" version.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rsvpId: string }> },
) {
  const { id: eventId, rsvpId } = await params;

  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  }

  let body: { status?: string; declineReason?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const nextStatus = body.status;
  if (!nextStatus || !['going', 'maybe', 'not_going', 'invited', 'requested'].includes(nextStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const service = createServiceClient();

  // Load current RSVP + event in parallel so we can compose the decision email.
  const [rsvpRes, eventRes] = await Promise.all([
    service.from('event_rsvps').select('*').eq('id', rsvpId).eq('event_id', eventId).maybeSingle(),
    service.from('events').select('title, slug, starts_at, location').eq('id', eventId).maybeSingle(),
  ]);

  const rsvp = rsvpRes.data as {
    id: string; status: string; user_id: string | null; invited_email: string | null;
  } | null;
  if (!rsvp) return NextResponse.json({ error: 'RSVP not found' }, { status: 404 });

  const event = eventRes.data as {
    title: string; slug: string; starts_at: string; location: string | null;
  } | null;
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const wasRequested = rsvp.status === 'requested';
  const approving = wasRequested && nextStatus === 'going';
  const denying = wasRequested && nextStatus === 'not_going';

  // Clear token on any response state change (it's only needed pre-response).
  const { error: updateErr } = await service
    .from('event_rsvps')
    .update({
      status: nextStatus,
      responded_at: new Date().toISOString(),
      token: null,
    })
    .eq('id', rsvpId);
  if (updateErr) {
    console.error('[admin:events:rsvps:update] failed:', updateErr);
    return NextResponse.json({ error: 'Failed to update RSVP' }, { status: 500 });
  }

  // Decision email for request approvals/denials — resolve recipient email
  // (user_id → profiles.email takes priority, fall back to invited_email).
  if (approving || denying) {
    let recipientEmail = rsvp.invited_email || '';
    if (rsvp.user_id) {
      const { data: profile } = await service
        .from('profiles')
        .select('email')
        .eq('user_id', rsvp.user_id)
        .maybeSingle();
      if (profile?.email) recipientEmail = profile.email;
    }

    if (recipientEmail) {
      sendEventRsvpDecision({
        toEmail: recipientEmail,
        eventTitle: event.title,
        eventSlug: event.slug,
        eventStartsAt: event.starts_at,
        eventLocation: event.location,
        approved: approving,
        declineReason: denying ? (body.declineReason || undefined) : undefined,
      }).catch((e) => console.error('[admin:events:rsvps:update] decision email failed:', e));
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/events/[id]/rsvps/[rsvpId] — remove a row entirely.
 *
 * Different from setting status='not_going' — this pretends the RSVP never
 * existed (useful for cleaning up test data or spam requests). No email sent.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rsvpId: string }> },
) {
  const { id: eventId, rsvpId } = await params;

  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from('event_rsvps')
    .delete()
    .eq('id', rsvpId)
    .eq('event_id', eventId);
  if (error) {
    console.error('[admin:events:rsvps:delete] failed:', error);
    return NextResponse.json({ error: 'Failed to delete RSVP' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
