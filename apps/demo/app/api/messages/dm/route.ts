// app/api/messages/dm/route.ts
//
// Create-or-reuse a direct thread under the permission matrix (Plan 4):
// staff + producers reach anyone; artists reach staff + producers only;
// artist↔artist is impossible by any path. POST { target_user_id } (legacy)
// or { target_user_ids: string[] } for small groups. 1:1 pairs always reuse
// (legacy producer_dm threads count); groups create fresh 'dm' threads.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { canDirectMessageAll } from '@/lib/messaging-matrix';
import { resolveParty, resolveParties, findOrCreateDmThread } from '@/lib/messaging-server';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Back-compat: MessageButton still sends target_user_id (singular).
  const rawIds = Array.isArray(body.target_user_ids)
    ? (body.target_user_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : typeof body.target_user_id === 'string' ? [body.target_user_id] : [];
  const targetIds = Array.from(new Set(rawIds.map((s) => s.trim()).filter(Boolean)));

  if (targetIds.length === 0) {
    return NextResponse.json({ error: 'target_user_ids required' }, { status: 400 });
  }
  if (targetIds.includes(user.id)) {
    return NextResponse.json({ error: "You can't DM yourself" }, { status: 400 });
  }

  const db = createServiceClient();
  const [sender, targets] = await Promise.all([
    resolveParty(db, user.id),
    resolveParties(db, targetIds),
  ]);
  if (!sender) return NextResponse.json({ error: 'Profile lookup failed' }, { status: 500 });
  if (targets.length !== targetIds.length) {
    return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
  }

  // THE matrix gate — the only authority on who may open a thread with whom.
  const verdict = canDirectMessageAll(sender, targets);
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason ?? 'Not allowed' }, { status: 403 });
  }

  try {
    const { threadId, reused } = await findOrCreateDmThread(db, sender, targets);
    return NextResponse.json({ thread_id: threadId, reused });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `Could not create DM thread: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 },
    );
  }
}
