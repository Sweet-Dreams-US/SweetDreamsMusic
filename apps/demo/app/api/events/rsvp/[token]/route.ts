import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/events/rsvp/[token] — respond to an email invitation.
 *
 * No authentication required — the token IS the authentication. Same model
 * as band invites. The token is a 32-byte base64url string, effectively
 * unguessable.
 *
 * Body: { status: 'going' | 'maybe' | 'not_going' }
 *
 * Sets responded_at and clears the token (one-shot use). If the user wants
 * to change their mind later, they can use the logged-in self-RSVP flow,
 * OR the admin can re-invite them (which generates a fresh token).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let body: { status?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const status = body.status;
  if (!status || !['going', 'maybe', 'not_going'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: rsvp } = await service
    .from('event_rsvps')
    .select('id, event_id, status, responded_at')
    .eq('token', token)
    .maybeSingle();

  if (!rsvp) {
    return NextResponse.json({ error: 'Invitation not found or already used' }, { status: 404 });
  }
  if (rsvp.status !== 'invited') {
    return NextResponse.json({ error: 'Invitation has already been handled' }, { status: 400 });
  }

  // Also sanity-check the event still exists and isn't cancelled.
  const { data: event } = await service
    .from('events')
    .select('id, slug, is_cancelled')
    .eq('id', rsvp.event_id)
    .maybeSingle();
  if (!event || event.is_cancelled) {
    return NextResponse.json({ error: 'This event is no longer available' }, { status: 400 });
  }

  const { error } = await service
    .from('event_rsvps')
    .update({
      status,
      responded_at: new Date().toISOString(),
      token: null, // one-shot: clear so the link can't be reused
    })
    .eq('id', rsvp.id);

  if (error) {
    console.error('[events:rsvp:token] update failed:', error);
    return NextResponse.json({ error: 'Failed to record response' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventSlug: event.slug, status });
}
