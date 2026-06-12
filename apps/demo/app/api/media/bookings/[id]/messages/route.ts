// app/api/media/bookings/[id]/messages/route.ts
//
// Round 8b: chat thread per media booking. One endpoint serves admin,
// buyer, engineer — viewer's role is inferred from their session, then
// access is gated to the booking. The same role drives author_role on
// any message they post.
//
// Access rules (mirror migration 047 RLS policies, but enforced server-
// side because we use the service client for the actual reads/writes):
//   • admin (profiles.role='admin')      → all bookings
//   • buyer (booking.user_id === uid)    → their own
//   • band member (band_id matches)      → their band's bookings
//   • engineer on a session of this booking → that booking
//
// Message bodies come back already joined with author display_name so the
// UI doesn't need a second round-trip per message.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendNewMediaMessageNotification } from '@/lib/email';

type AuthorRole = 'admin' | 'buyer' | 'engineer' | 'system';

interface Attachment {
  label: string;
  url: string;
  kind: 'image' | 'video' | 'file' | 'link';
}

// Resolve the viewer's relationship to this booking. Returns the role
// they're allowed to act as, or null if they have no claim.
async function resolveViewerRole(
  service: ReturnType<typeof createServiceClient>,
  user: { id: string; role: string },
  bookingId: string,
): Promise<AuthorRole | null> {
  if (user.role === 'admin') return 'admin';

  // Pull booking owner + band_id to evaluate buyer / band paths.
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('user_id, band_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (!bookingRow) return null;
  const booking = bookingRow as { user_id: string; band_id: string | null };

  if (booking.user_id === user.id) return 'buyer';

  if (booking.band_id) {
    const { data: membership } = await service
      .from('band_members')
      .select('id')
      .eq('band_id', booking.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership) return 'buyer'; // band members see + post as 'buyer' role
  }

  // Engineer attached to a session?
  const { data: session } = await service
    .from('media_session_bookings')
    .select('id')
    .eq('parent_booking_id', bookingId)
    .eq('engineer_id', user.id)
    .limit(1)
    .maybeSingle();
  if (session) return 'engineer';

  return null;
}

// ── GET: fetch thread ──────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const role = await resolveViewerRole(service, user, id);
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: messages, error } = await service
    .from('media_booking_messages')
    .select('id, author_user_id, author_role, body, attachments, created_at')
    .eq('booking_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Batch resolve display_name for each author. One query per booking
  // thread, regardless of message count.
  const authorIds = Array.from(
    new Set((messages ?? []).map((m) => m.author_user_id).filter((v): v is string => !!v)),
  );
  const authorNames: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profiles } = await service
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', authorIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string; display_name: string | null }>) {
      authorNames[p.user_id] = p.display_name ?? 'Unknown';
    }
  }

  return NextResponse.json({
    role, // tells the UI how to style itself + label the input
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      author_user_id: m.author_user_id,
      author_name: m.author_user_id ? authorNames[m.author_user_id] ?? 'Unknown' : 'System',
      author_role: m.author_role,
      body: m.body,
      attachments: m.attachments,
      created_at: m.created_at,
    })),
  });
}

// ── POST: append a message ─────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!messageBody && rawAttachments.length === 0) {
    return NextResponse.json(
      { error: 'Message must have a body or at least one attachment' },
      { status: 400 },
    );
  }
  if (messageBody.length > 5000) {
    return NextResponse.json({ error: 'Message too long (5000 char max)' }, { status: 400 });
  }

  // Validate attachments shape. Each entry: { label, url, kind }.
  // URL must be http/https; everything else is rejected.
  const attachments: Attachment[] = [];
  for (const raw of rawAttachments) {
    if (!raw || typeof raw !== 'object') continue;
    const label = typeof (raw as { label?: unknown }).label === 'string'
      ? ((raw as { label: string }).label).trim()
      : '';
    const url = typeof (raw as { url?: unknown }).url === 'string'
      ? ((raw as { url: string }).url).trim()
      : '';
    const kindRaw = (raw as { kind?: unknown }).kind;
    const kind: Attachment['kind'] =
      kindRaw === 'image' || kindRaw === 'video' || kindRaw === 'file' || kindRaw === 'link'
        ? kindRaw
        : 'link';
    if (!url || !/^https?:\/\//i.test(url)) continue; // skip invalid
    attachments.push({ label: label || url, url, kind });
  }
  if (attachments.length > 10) {
    return NextResponse.json({ error: 'Max 10 attachments per message' }, { status: 400 });
  }

  const service = createServiceClient();
  const role = await resolveViewerRole(service, user, id);
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (role === 'system') {
    // Only the server posts system messages; reject if a client tries.
    return NextResponse.json({ error: 'Forbidden role' }, { status: 403 });
  }

  const { data: row, error } = await service
    .from('media_booking_messages')
    .insert({
      booking_id: id,
      author_user_id: user.id,
      author_role: role,
      body: messageBody,
      attachments,
    })
    .select('id, created_at')
    .single();
  if (error || !row) {
    return NextResponse.json(
      { error: `Could not post message: ${error?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // Audit log entry — keeps the planning timeline unified with payment /
  // status events. Snake-case verb conventions match Round 7c.
  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: 'message_posted',
    performed_by: user.email,
    details: {
      message_id: row.id,
      author_role: role,
      body_preview: messageBody.slice(0, 120),
      attachment_count: attachments.length,
    },
  });

  // Email digest — fire-and-forget. The other side(s) get an email so
  // they know to come check the thread. Author role drives recipients:
  //   • buyer or engineer wrote → notify admins
  //   • admin wrote             → notify buyer
  // Engineer always loops in admins; admin posts CC the engineer if any.
  try {
    await sendNewMediaMessageNotification({
      bookingId: id,
      authorRole: role,
      authorName: user.profile?.display_name ?? user.email.split('@')[0],
      bodyPreview: messageBody.slice(0, 240),
      hasAttachments: attachments.length > 0,
    });
  } catch (e) {
    console.error('[messages] notification email failed:', e);
  }

  return NextResponse.json({
    success: true,
    message: {
      id: row.id,
      author_user_id: user.id,
      author_name: user.profile?.display_name ?? user.email.split('@')[0],
      author_role: role,
      body: messageBody,
      attachments,
      created_at: row.created_at,
    },
  });
}
