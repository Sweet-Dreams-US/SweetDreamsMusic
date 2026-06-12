// app/api/messages/threads/[id]/route.ts
//
// Round 9b: thread detail.
//
//   GET   — load all messages on this thread (oldest → newest), each
//           with the author's display_name resolved. Marks thread as
//           read for this user as a side effect (last_read_at = now).
//   POST  — append a new message. Validates body + attachments,
//           resolves author_role from session, writes message + audit
//           log entry. Trigger updates last_message_at automatically.
//
// Access is gated by RLS — the service client we use bypasses RLS, so
// we mirror the policy logic in code (resolveAccess) before reading or
// writing. Same shape as Round 8b's media-booking-messages endpoint.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendNewMediaMessageNotification } from '@/lib/email';
import type { AuthorRole, Attachment, Thread } from '@/lib/messaging';

type AccessResult =
  | { ok: false }
  | { ok: true; thread: Thread; role: AuthorRole };

async function resolveAccess(
  service: ReturnType<typeof createServiceClient>,
  user: { id: string; role: string },
  threadId: string,
): Promise<AccessResult> {
  const { data: threadRow } = await service
    .from('message_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  const thread = threadRow as Thread | null;
  if (!thread) return { ok: false };

  // Studio thread (kind 'sweet_dreams'): owner OR staff (admin/engineer/media manager)
  if (thread.kind === 'sweet_dreams') {
    if (thread.owner_user_id === user.id) return { ok: true, thread, role: 'buyer' };
    if (user.role === 'admin') return { ok: true, thread, role: 'admin' };
    if (user.role === 'engineer') return { ok: true, thread, role: 'engineer' };
    if (user.role === 'media_manager') return { ok: true, thread, role: 'media_manager' };
    return { ok: false };
  }

  // Media booking thread: buyer/band/admin/engineer-on-session
  if (thread.kind === 'media_booking' && thread.media_booking_id) {
    if (user.role === 'admin') return { ok: true, thread, role: 'admin' };
    const { data: bookingRow } = await service
      .from('media_bookings')
      .select('user_id, band_id')
      .eq('id', thread.media_booking_id)
      .maybeSingle();
    const b = bookingRow as { user_id: string; band_id: string | null } | null;
    if (!b) return { ok: false };
    if (b.user_id === user.id) return { ok: true, thread, role: 'buyer' };
    if (b.band_id) {
      const { data: m } = await service
        .from('band_members')
        .select('id')
        .eq('band_id', b.band_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (m) return { ok: true, thread, role: 'buyer' };
    }
    const { data: s } = await service
      .from('media_session_bookings')
      .select('id')
      .eq('parent_booking_id', thread.media_booking_id)
      .eq('engineer_id', user.id)
      .limit(1)
      .maybeSingle();
    if (s) return { ok: true, thread, role: 'engineer' };
    return { ok: false };
  }

  // Direct threads ('dm' + legacy 'producer_dm'): only participants. The
  // author role comes from WHO the user is (staff roles speak as themselves),
  // falling back to the participant tag for producers/artists.
  if (thread.kind === 'producer_dm' || thread.kind === 'dm') {
    const { data: p } = await service
      .from('message_thread_participants')
      .select('role')
      .eq('thread_id', thread.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!p) return { ok: false };
    const partRole = (p as { role: string }).role;
    const role: AuthorRole =
      user.role === 'admin' ? 'admin' :
      user.role === 'engineer' ? 'engineer' :
      user.role === 'media_manager' ? 'media_manager' :
      partRole === 'producer' ? 'producer' : 'buyer';
    return { ok: true, thread, role };
  }

  return { ok: false };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { id } = await params;
  const service = createServiceClient();

  const access = await resolveAccess(service, user, id);
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: messages, error } = await service
    .from('messages')
    .select('id, thread_id, author_user_id, author_role, kind, body, attachments, created_at')
    .eq('thread_id', id)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve author display names — one batched profiles query
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

  // Mark thread as read for this user (upsert participant row).
  await service
    .from('message_thread_participants')
    .upsert(
      {
        thread_id: id,
        user_id: user.id,
        role: access.thread.kind === 'sweet_dreams' && access.thread.owner_user_id === user.id ? 'owner' : access.role === 'producer' ? 'producer' : access.role === 'admin' || access.role === 'engineer' || access.role === 'media_manager' ? 'staff' : 'owner',
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,user_id' },
    );

  return NextResponse.json({
    thread: access.thread,
    role: access.role,
    messages: (messages ?? []).map((m) => ({
      ...m,
      author_name: m.author_user_id ? authorNames[m.author_user_id] ?? 'Unknown' : 'System',
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!messageBody && rawAttachments.length === 0) {
    return NextResponse.json({ error: 'Message must have a body or attachment' }, { status: 400 });
  }
  if (messageBody.length > 5000) {
    return NextResponse.json({ error: 'Message too long (5000 char max)' }, { status: 400 });
  }

  const attachments: Attachment[] = [];
  for (const raw of rawAttachments) {
    if (!raw || typeof raw !== 'object') continue;
    const label = typeof (raw as { label?: unknown }).label === 'string'
      ? ((raw as { label: string }).label).trim() : '';
    const url = typeof (raw as { url?: unknown }).url === 'string'
      ? ((raw as { url: string }).url).trim() : '';
    const kindRaw = (raw as { kind?: unknown }).kind;
    const kind: Attachment['kind'] =
      kindRaw === 'image' || kindRaw === 'video' || kindRaw === 'file' || kindRaw === 'link' ? kindRaw : 'link';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    attachments.push({ label: label || url, url, kind });
  }
  if (attachments.length > 10) {
    return NextResponse.json({ error: 'Max 10 attachments per message' }, { status: 400 });
  }

  const service = createServiceClient();
  const access = await resolveAccess(service, user, id);
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: row, error } = await service
    .from('messages')
    .insert({
      thread_id: id,
      author_user_id: user.id,
      author_role: access.role,
      kind: 'chat',
      body: messageBody,
      attachments,
    })
    .select('id, created_at')
    .single();
  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  // Audit + email digest. For booking threads, mirror the Round 8b
  // helper (it knows how to resolve buyer + admin emails). For other
  // thread kinds, log only — Round 9e will wire dedicated email helpers.
  if (access.thread.kind === 'media_booking' && access.thread.media_booking_id) {
    await service.from('media_booking_audit_log').insert({
      booking_id: access.thread.media_booking_id,
      action: 'message_posted',
      performed_by: user.email,
      details: {
        message_id: row.id,
        thread_id: id,
        author_role: access.role,
        body_preview: messageBody.slice(0, 120),
        attachment_count: attachments.length,
      },
    });
    // Notification helper takes only admin|buyer|engineer; producer
    // doesn't apply on a booking thread (producers don't have access
    // to booking threads at all), and system isn't a user-post role.
    const notifierRole: 'admin' | 'buyer' | 'engineer' =
      access.role === 'admin' ? 'admin' :
      access.role === 'engineer' ? 'engineer' :
      'buyer';
    try {
      await sendNewMediaMessageNotification({
        bookingId: access.thread.media_booking_id,
        authorRole: notifierRole,
        authorName: user.profile?.display_name ?? user.email.split('@')[0],
        bodyPreview: messageBody.slice(0, 240),
        hasAttachments: attachments.length > 0,
      });
    } catch (e) { console.error('[messages] notification failed:', e); }
  }

  return NextResponse.json({
    success: true,
    message: {
      id: row.id,
      thread_id: id,
      author_user_id: user.id,
      author_role: access.role,
      author_name: user.profile?.display_name ?? user.email.split('@')[0],
      kind: 'chat' as const,
      body: messageBody,
      attachments,
      created_at: row.created_at,
    },
  });
}
