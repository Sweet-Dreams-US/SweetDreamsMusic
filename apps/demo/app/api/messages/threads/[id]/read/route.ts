// app/api/messages/threads/[id]/read/route.ts
//
// POST — mark a thread as read for the signed-in user. Upserts the
// participant row's last_read_at to NOW(). Used by the inbox UI when
// opening a thread (also called by GET on /api/messages/threads/[id]).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import type { Thread } from '@/lib/messaging';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { id } = await params;

  const service = createServiceClient();

  // Verify the user has access to this thread before stamping read.
  // Reuse minimal access check inline (full resolveAccess lives in the
  // detail route — we only need a yes/no here).
  const { data: threadRow } = await service
    .from('message_threads')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  const thread = threadRow as Thread | null;
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let hasAccess = false;
  if (thread.kind === 'sweet_dreams') {
    hasAccess = thread.owner_user_id === user.id || user.role === 'admin' || user.role === 'engineer' || user.role === 'media_manager';
  } else if (thread.kind === 'media_booking' && thread.media_booking_id) {
    if (user.role === 'admin') hasAccess = true;
    else {
      const { data: b } = await service
        .from('media_bookings')
        .select('user_id, band_id')
        .eq('id', thread.media_booking_id)
        .maybeSingle();
      const booking = b as { user_id: string; band_id: string | null } | null;
      if (booking?.user_id === user.id) hasAccess = true;
      else if (booking?.band_id) {
        const { data: m } = await service
          .from('band_members')
          .select('id')
          .eq('band_id', booking.band_id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (m) hasAccess = true;
      }
      if (!hasAccess) {
        const { data: s } = await service
          .from('media_session_bookings')
          .select('id')
          .eq('parent_booking_id', thread.media_booking_id)
          .eq('engineer_id', user.id)
          .limit(1)
          .maybeSingle();
        if (s) hasAccess = true;
      }
    }
  } else if (thread.kind === 'producer_dm' || thread.kind === 'dm') {
    const { data: p } = await service
      .from('message_thread_participants')
      .select('role')
      .eq('thread_id', thread.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (p) hasAccess = true;
  }

  if (!hasAccess) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Determine participant role for upsert
  let role: 'owner' | 'staff' | 'producer' = 'owner';
  if (thread.kind === 'sweet_dreams' && thread.owner_user_id !== user.id) {
    role = 'staff'; // admin/engineer reading someone else's SD thread
  } else if (thread.kind === 'producer_dm' || thread.kind === 'dm') {
    // Look up existing role; fall back to 'owner' (buyer side)
    const { data: existing } = await service
      .from('message_thread_participants')
      .select('role')
      .eq('thread_id', thread.id)
      .eq('user_id', user.id)
      .maybeSingle();
    role = ((existing as { role: 'owner' | 'staff' | 'producer' } | null)?.role) ?? 'owner';
  } else if (thread.kind === 'media_booking') {
    role = user.role === 'admin' || user.role === 'engineer' || user.role === 'media_manager' ? 'staff' : 'owner';
  }

  await service
    .from('message_thread_participants')
    .upsert(
      {
        thread_id: id,
        user_id: user.id,
        role,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,user_id' },
    );

  return NextResponse.json({ ok: true });
}
