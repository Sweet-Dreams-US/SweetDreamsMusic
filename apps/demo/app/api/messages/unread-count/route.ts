// app/api/messages/unread-count/route.ts
//
// GET — returns the count of threads where the user has unread messages.
// Capped at 10 (UI displays "9+" anything above that). Used by the
// top-nav unread bell badge.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const MAX_COUNT = 10;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const service = createServiceClient();

  // Pull all threads visible to this user. Reuses the same union approach
  // as the inbox-list endpoint, but skips the per-thread enrichment —
  // we only need the IDs to compute unread.
  const userId = user.id;

  // SD thread: owner only. Staff don't get unread on every user's SD —
  // that's the support queue's job, not the personal bell.
  const { data: sdRows } = await service
    .from('message_threads')
    .select('id, last_message_at')
    .eq('kind', 'sweet_dreams')
    .eq('owner_user_id', userId);

  // Booking threads — filter as in the inbox-list endpoint
  let bookingThreads: Array<{ id: string; last_message_at: string }> = [];
  {
    const { data: ownedBookings } = await service
      .from('media_bookings')
      .select('id')
      .eq('user_id', userId);
    const { data: bandMemberships } = await service
      .from('band_members')
      .select('band_id')
      .eq('user_id', userId);
    const bandIds = (bandMemberships ?? []).map((m: { band_id: string }) => m.band_id);
    let bandBookings: Array<{ id: string }> = [];
    if (bandIds.length > 0) {
      const { data } = await service
        .from('media_bookings')
        .select('id')
        .in('band_id', bandIds);
      bandBookings = (data ?? []) as Array<{ id: string }>;
    }
    const { data: engineerSessions } = await service
      .from('media_session_bookings')
      .select('parent_booking_id')
      .eq('engineer_id', userId);
    const engineerBookingIds = Array.from(
      new Set((engineerSessions ?? []).map((s: { parent_booking_id: string }) => s.parent_booking_id)),
    );

    let bookingIds: string[] = [];
    if (user.role === 'admin') {
      const { data: allBookings } = await service.from('media_bookings').select('id');
      bookingIds = ((allBookings ?? []) as Array<{ id: string }>).map((b) => b.id);
    } else {
      bookingIds = Array.from(
        new Set([
          ...(ownedBookings ?? []).map((b: { id: string }) => b.id),
          ...bandBookings.map((b) => b.id),
          ...engineerBookingIds,
        ]),
      );
    }
    if (bookingIds.length > 0) {
      const { data } = await service
        .from('message_threads')
        .select('id, last_message_at')
        .eq('kind', 'media_booking')
        .in('media_booking_id', bookingIds);
      bookingThreads = (data ?? []) as typeof bookingThreads;
    }
  }

  // Producer DMs — participant rows
  let dmThreads: Array<{ id: string; last_message_at: string }> = [];
  {
    const { data: parts } = await service
      .from('message_thread_participants')
      .select('thread_id')
      .eq('user_id', userId);
    const threadIds = (parts ?? []).map((p: { thread_id: string }) => p.thread_id);
    if (threadIds.length > 0) {
      const { data } = await service
        .from('message_threads')
        .select('id, last_message_at')
        .in('kind', ['producer_dm', 'dm'])
        .in('id', threadIds);
      dmThreads = (data ?? []) as typeof dmThreads;
    }
  }

  const allThreads = [
    ...((sdRows ?? []) as Array<{ id: string; last_message_at: string }>),
    ...bookingThreads,
    ...dmThreads,
  ];
  if (allThreads.length === 0) {
    return NextResponse.json({ count: 0, capped: false });
  }

  // last_read_at per (thread, user)
  const { data: parts } = await service
    .from('message_thread_participants')
    .select('thread_id, last_read_at')
    .eq('user_id', userId)
    .in('thread_id', allThreads.map((t) => t.id));
  const lastReadByThread = new Map<string, string>();
  for (const p of (parts ?? []) as Array<{ thread_id: string; last_read_at: string }>) {
    lastReadByThread.set(p.thread_id, p.last_read_at);
  }

  let count = 0;
  for (const t of allThreads) {
    const lastRead = lastReadByThread.get(t.id);
    if (!lastRead || t.last_message_at > lastRead) {
      count++;
      if (count >= MAX_COUNT) break;
    }
  }

  // Cap at 9 + capped flag so the UI renders "9+" without leaking the
  // real number. Staff get unread on their OWN inbox here; the support
  // queue at /admin/messages handles cross-user unread separately.
  return NextResponse.json({
    count: Math.min(count, MAX_COUNT - 1),
    capped: count >= MAX_COUNT,
  });
}
