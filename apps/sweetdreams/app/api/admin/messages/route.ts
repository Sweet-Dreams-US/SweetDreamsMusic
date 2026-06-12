// app/api/admin/messages/route.ts
//
// Round 9e: admin support queue. Returns all Sweet Dreams threads
// across the platform, sorted by last_message_at desc. Each row
// includes the buyer's display_name + email + last-message preview +
// "needs reply" flag (true when the latest message is from a non-staff
// user, meaning a buyer/producer asked something a staff member hasn't
// answered yet).
//
// Admin-only. Per-booking + DM threads do NOT show here — they have
// their own surfaces (admin Media tab + the producer's own inbox).

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

interface SupportRow {
  thread_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_author_role: string | null;
  needs_reply: boolean;
  message_count: number;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const service = createServiceClient();

  // All Sweet Dreams threads
  const { data: threads, error } = await service
    .from('message_threads')
    .select('id, owner_user_id, last_message_at')
    .eq('kind', 'sweet_dreams')
    .order('last_message_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type T = { id: string; owner_user_id: string; last_message_at: string };
  const threadsArr = (threads ?? []) as T[];
  if (threadsArr.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // Batch resolve owner profiles
  const ownerIds = threadsArr.map((t) => t.owner_user_id);
  const { data: profiles } = await service
    .from('profiles')
    .select('user_id, display_name, email')
    .in('user_id', ownerIds);
  const profileByUserId = new Map<string, { display_name: string | null; email: string | null }>();
  for (const p of (profiles ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
    profileByUserId.set(p.user_id, { display_name: p.display_name, email: p.email });
  }

  // Pull the last message for each thread to compute needs-reply state.
  // Single query ordered by created_at desc; we walk through and pick
  // the first message per thread.
  const { data: latestMessages } = await service
    .from('messages')
    .select('thread_id, body, author_role, created_at')
    .in('thread_id', threadsArr.map((t) => t.id))
    .order('created_at', { ascending: false });

  type M = { thread_id: string; body: string | null; author_role: string; created_at: string };
  const lastByThread = new Map<string, M>();
  const countByThread = new Map<string, number>();
  for (const m of (latestMessages ?? []) as M[]) {
    if (!lastByThread.has(m.thread_id)) lastByThread.set(m.thread_id, m);
    countByThread.set(m.thread_id, (countByThread.get(m.thread_id) ?? 0) + 1);
  }

  const rows: SupportRow[] = threadsArr.map((t) => {
    const profile = profileByUserId.get(t.owner_user_id);
    const last = lastByThread.get(t.id);
    return {
      thread_id: t.id,
      user_id: t.owner_user_id,
      user_name: profile?.display_name ?? 'Unknown',
      user_email: profile?.email ?? '(no email)',
      last_message_at: t.last_message_at,
      last_message_preview: last?.body?.slice(0, 200) ?? null,
      last_author_role: last?.author_role ?? null,
      // Needs reply when latest message is from a non-staff side
      // (buyer or producer). System messages don't count — those are
      // automated mirrors, not asks.
      needs_reply: !!last && (last.author_role === 'buyer' || last.author_role === 'producer'),
      message_count: countByThread.get(t.id) ?? 0,
    };
  });

  return NextResponse.json({ rows });
}
