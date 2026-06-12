import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEventRsvpRequestAlert } from '@/lib/email';

/**
 * POST /api/events/[slug]/rsvp — self-service RSVP.
 *
 * Requires authentication. The behavior depends on the event's visibility:
 *
 *   public          → any status (going / maybe / not_going) accepted immediately
 *   private_listed  → only 'requested' allowed; admin must approve before 'going'
 *   private_hidden  → not reachable from public pages; this endpoint returns 404
 *                     (the slug resolves but we pretend the event doesn't exist)
 *
 * Idempotent: POSTing twice updates the existing RSVP row. Useful so a user
 * can change their mind from going → maybe → not_going without DB errors.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { status?: string; message?: string; guestCount?: number };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const status = body.status;
  if (!status || !['going', 'maybe', 'not_going', 'requested'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  const guestCount = typeof body.guestCount === 'number' && body.guestCount >= 0
    ? Math.min(body.guestCount, 20)
    : 0;
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  const service = createServiceClient();

  const { data: event } = await service
    .from('events')
    .select('id, slug, title, visibility, is_cancelled, capacity')
    .eq('slug', slug)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if (event.visibility === 'private_hidden') {
    // Don't leak existence — same response as "not found".
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  if (event.is_cancelled) {
    return NextResponse.json({ error: 'This event was cancelled' }, { status: 400 });
  }

  // Visibility → allowed status rules.
  if (event.visibility === 'public') {
    if (status === 'requested') {
      return NextResponse.json(
        { error: "This event is open — you don't need to request to attend." },
        { status: 400 },
      );
    }
  } else {
    // private_listed
    if (status !== 'requested') {
      return NextResponse.json(
        { error: 'This event requires approval. Submit a request to attend first.' },
        { status: 400 },
      );
    }
    if (!message) {
      return NextResponse.json(
        { error: 'Please include a short message about why you\'d like to attend.' },
        { status: 400 },
      );
    }
  }

  // Delegate to the RPC — it locks the event row with SELECT ... FOR UPDATE,
  // re-checks capacity atomically, and performs the upsert. See migration
  // 036_rsvp_capacity_rpc.sql. Prevents two simultaneous "Going" clicks from
  // both slipping past a capacity check that only has one seat remaining.
  const { data: rpcResult, error: rpcError } = await service.rpc(
    'rsvp_with_capacity_check',
    {
      p_event_id: event.id,
      p_user_id: user.id,
      p_status: status,
      p_message: message,
      p_guest_count: guestCount,
    },
  );

  if (rpcError) {
    console.error('[events:rsvp] rpc failed:', rpcError);
    return NextResponse.json({ error: 'Failed to record RSVP' }, { status: 500 });
  }

  // The RPC returns JSONB; the supabase-js client hands it back as a plain object.
  const result = rpcResult as {
    ok: boolean;
    code?: string;
    error?: string;
    rsvp_id?: string;
    current?: number;
    capacity?: number;
  } | null;

  if (!result || !result.ok) {
    const code = result?.code;
    // Map domain error codes to HTTP status codes.
    if (code === 'NOT_FOUND') {
      return NextResponse.json({ error: result?.error ?? 'Event not found' }, { status: 404 });
    }
    if (code === 'CANCELLED') {
      return NextResponse.json({ error: result?.error ?? 'Event was cancelled' }, { status: 400 });
    }
    if (code === 'CAPACITY_FULL') {
      return NextResponse.json(
        {
          error: result?.error ?? 'Event is at capacity',
          current: result?.current,
          capacity: result?.capacity,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: result?.error ?? 'Failed to record RSVP' }, { status: 500 });
  }

  // When someone requests to attend a private_listed event, notify admins so
  // they can approve/deny. Fire-and-forget per the codebase convention.
  if (status === 'requested' && event.visibility === 'private_listed') {
    const requesterName = user.profile?.display_name || user.email;
    sendEventRsvpRequestAlert({
      eventTitle: event.title,
      eventId: event.id,
      requesterName,
      requesterEmail: user.email,
      message: message || '(no message)',
      guestCount,
    }).catch((e) => console.error('[events:rsvp] admin alert failed:', e));
  }

  return NextResponse.json({ ok: true, status });
}
