// app/api/messages/threads/route.ts
//
// GET the combined inbox for the signed-in user (Plan 4 §4).
//
// Artists: their studio thread (pinned) + booking threads + DMs.
// Staff: the same PLUS the studio threads of the people they serve —
//   admin → every user's studio thread; engineer → their session clients;
//   media manager → their media clients. One inbox, no tab hunting; the
//   client renders filter tabs. Producers reach people via DMs (matrix),
//   so they get no extra studio threads here.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import type { Thread, ThreadWithMeta } from '@/lib/messaging';
import { defaultThreadDisplayName } from '@/lib/messaging';
import { DM_KINDS, STUDIO_KIND } from '@/lib/messaging-matrix';
import { resolveParty, engineerClientUserIds, mediaClientUserIds } from '@/lib/messaging-server';

const STAFF_STUDIO_LIMIT = 200;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const service = createServiceClient();

  const [studio, bookings, dms] = await Promise.all([
    // 1. Studio threads: always the user's own; staff also get their people's.
    (async () => {
      const { data: own } = await service
        .from('message_threads')
        .select('*')
        .eq('kind', STUDIO_KIND)
        .eq('owner_user_id', user.id);
      const rows: Thread[] = [...((own ?? []) as Thread[])];

      if (user.role === 'admin') {
        const { data: all } = await service
          .from('message_threads')
          .select('*')
          .eq('kind', STUDIO_KIND)
          .neq('owner_user_id', user.id)
          .order('last_message_at', { ascending: false })
          .limit(STAFF_STUDIO_LIMIT);
        rows.push(...((all ?? []) as Thread[]));
      } else if (user.role === 'engineer' || user.role === 'media_manager') {
        const sender = await resolveParty(service, user.id);
        if (sender) {
          const clientIds = user.role === 'media_manager'
            ? await mediaClientUserIds(service, sender)
            : await engineerClientUserIds(service, sender);
          if (clientIds.length > 0) {
            const { data: clients } = await service
              .from('message_threads')
              .select('*')
              .eq('kind', STUDIO_KIND)
              .in('owner_user_id', clientIds)
              .order('last_message_at', { ascending: false })
              .limit(STAFF_STUDIO_LIMIT);
            rows.push(...((clients ?? []) as Thread[]));
          }
        }
      }
      return { data: rows };
    })(),

    // 2. Booking threads (unchanged union: owned / band / engineer-on-session;
    //    admins see all).
    (async () => {
      const { data: ownedBookings } = await service
        .from('media_bookings')
        .select('id, offering_id')
        .eq('user_id', user.id);
      const { data: bandMemberships } = await service
        .from('band_members')
        .select('band_id')
        .eq('user_id', user.id);
      const bandIds = (bandMemberships ?? []).map((m: { band_id: string }) => m.band_id);
      let bandBookings: Array<{ id: string; offering_id: string }> = [];
      if (bandIds.length > 0) {
        const { data } = await service
          .from('media_bookings')
          .select('id, offering_id')
          .in('band_id', bandIds);
        bandBookings = (data ?? []) as typeof bandBookings;
      }
      const { data: engineerSessions } = await service
        .from('media_session_bookings')
        .select('parent_booking_id')
        .eq('engineer_id', user.id);
      const engineerBookingIds = Array.from(
        new Set((engineerSessions ?? []).map((s: { parent_booking_id: string }) => s.parent_booking_id)),
      );

      let bookingIds: string[] = [];
      if (user.role === 'admin') {
        const { data: allBookings } = await service
          .from('media_bookings')
          .select('id, offering_id');
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
      if (bookingIds.length === 0) return { data: [] };

      const { data: threads } = await service
        .from('message_threads')
        .select('*')
        .eq('kind', 'media_booking')
        .in('media_booking_id', bookingIds);

      const threadsArr = (threads ?? []) as Thread[];
      const bookingIdToOfferingId = new Map<string, string>();
      const allBookingsResp = await service
        .from('media_bookings')
        .select('id, offering_id')
        .in('id', bookingIds);
      for (const b of (allBookingsResp.data ?? []) as Array<{ id: string; offering_id: string }>) {
        bookingIdToOfferingId.set(b.id, b.offering_id);
      }
      const offeringIds = Array.from(new Set(Array.from(bookingIdToOfferingId.values())));
      const titlesResp = offeringIds.length > 0
        ? await service.from('media_offerings').select('id, title').in('id', offeringIds)
        : { data: [] };
      const offeringTitles = new Map<string, string>();
      for (const o of (titlesResp.data ?? []) as Array<{ id: string; title: string }>) {
        offeringTitles.set(o.id, o.title);
      }

      return {
        data: threadsArr.map((t) => ({
          ...t,
          subject: t.media_booking_id
            ? offeringTitles.get(bookingIdToOfferingId.get(t.media_booking_id) ?? '') ?? t.subject
            : t.subject,
        })),
      };
    })(),

    // 3. DMs — generic 'dm' + legacy 'producer_dm', via participants.
    (async () => {
      const { data: parts } = await service
        .from('message_thread_participants')
        .select('thread_id')
        .eq('user_id', user.id);
      const threadIds = (parts ?? []).map((p: { thread_id: string }) => p.thread_id);
      if (threadIds.length === 0) return { data: [] };
      const { data: threads } = await service
        .from('message_threads')
        .select('*')
        .in('kind', DM_KINDS as unknown as string[])
        .in('id', threadIds);
      return { data: threads ?? [] };
    })(),
  ]);

  // De-dupe (a staff member's own SD thread can't collide, but belt-and-suspenders).
  const seen = new Set<string>();
  const allThreads: Thread[] = [
    ...((studio.data ?? []) as Thread[]),
    ...((bookings.data ?? []) as Thread[]),
    ...((dms.data ?? []) as Thread[]),
  ].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));

  if (allThreads.length === 0) {
    return NextResponse.json({ threads: [] });
  }

  // Owner names for OTHER people's studio threads (staff view).
  const otherOwnerIds = Array.from(new Set(
    allThreads
      .filter((t) => t.kind === STUDIO_KIND && t.owner_user_id && t.owner_user_id !== user.id)
      .map((t) => t.owner_user_id as string),
  ));
  const ownerNames = new Map<string, string>();
  if (otherOwnerIds.length > 0) {
    const { data: owners } = await service
      .from('profiles')
      .select('user_id, display_name, email')
      .in('user_id', otherOwnerIds);
    for (const o of (owners ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
      ownerNames.set(o.user_id, o.display_name || o.email || 'User');
    }
  }

  const { data: parts } = await service
    .from('message_thread_participants')
    .select('thread_id, last_read_at')
    .eq('user_id', user.id)
    .in('thread_id', allThreads.map((t) => t.id));
  const lastReadByThread = new Map<string, string>();
  for (const p of (parts ?? []) as Array<{ thread_id: string; last_read_at: string }>) {
    lastReadByThread.set(p.thread_id, p.last_read_at);
  }

  const { data: previews } = await service
    .from('messages')
    .select('thread_id, body, author_role, kind, created_at')
    .in('thread_id', allThreads.map((t) => t.id))
    .order('created_at', { ascending: false });
  const latestByThread = new Map<string, { body: string | null; role: string; kind: string; at: string }>();
  for (const m of (previews ?? []) as Array<{ thread_id: string; body: string | null; author_role: string; kind: string; created_at: string }>) {
    if (!latestByThread.has(m.thread_id)) {
      latestByThread.set(m.thread_id, { body: m.body, role: m.author_role, kind: m.kind, at: m.created_at });
    }
  }

  const enriched: (ThreadWithMeta & { mine: boolean })[] = allThreads
    .map((t) => {
      const latest = latestByThread.get(t.id);
      const lastRead = lastReadByThread.get(t.id);
      const mine = !(t.kind === STUDIO_KIND && t.owner_user_id !== user.id);
      // Staff don't get "unread" on client studio threads they've never opened —
      // only after they're a participant (opened it once). Keeps the inbox calm.
      const unread = !!latest && (mine
        ? (!lastRead || latest.at > lastRead)
        : (!!lastRead && latest.at > lastRead));
      return {
        ...t,
        mine,
        display_name: t.kind === STUDIO_KIND && !mine
          ? (ownerNames.get(t.owner_user_id as string) ?? 'User')
          : defaultThreadDisplayName(t),
        unread,
        last_message_preview: latest?.body?.slice(0, 120) ?? undefined,
        last_message_role: latest?.role as ThreadWithMeta['last_message_role'],
      };
    })
    // Own studio thread pinned first, then recency.
    .sort((a, b) => {
      const aPin = a.kind === STUDIO_KIND && a.mine;
      const bPin = b.kind === STUDIO_KIND && b.mine;
      if (aPin && !bPin) return -1;
      if (bPin && !aPin) return 1;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });

  return NextResponse.json({ threads: enriched, viewer_role: user.role });
}
