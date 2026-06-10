// lib/messaging-server.ts — DB layer for the permission-matrix inbox (Plan 4).
//
// Client-injected (takes a db param, no next/headers) so it's importable from
// routes AND tsx scripts — same convention as lib/rewards-server.ts. Callers
// pass the SERVICE client; the routes gate identity + matrix first.
// The matrix itself is lib/messaging-matrix.ts (pure, golden-tested).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserRole } from '@/lib/utils';
import { TEST_EMAILS } from '@/lib/rewards-server';
import {
  canDirectMessageAll, authorRoleFor, participantRoleFor,
  DM_KINDS, STUDIO_KIND,
  type MatrixParty, type BroadcastSegment,
} from '@/lib/messaging-matrix';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

// ── party resolution ──────────────────────────────────────────────────────────

export interface Party extends MatrixParty {
  profileId: string;     // profiles.id (≠ user_id — beats.producer_id keys off THIS)
  email: string;
  name: string;
}

function rowToParty(p: any): Party {
  return {
    userId: p.user_id,
    profileId: p.id,
    email: p.email || '',
    name: p.display_name || p.email || 'User',
    role: getUserRole(p.email || undefined, p.role || undefined),
    isProducer: !!p.is_producer,
  };
}

export async function resolveParty(db: Client, userId: string): Promise<Party | null> {
  const { data } = await db.from('profiles')
    .select('id,user_id,email,display_name,role,is_producer')
    .eq('user_id', userId).maybeSingle();
  return data ? rowToParty(data) : null;
}

export async function resolveParties(db: Client, userIds: string[]): Promise<Party[]> {
  if (userIds.length === 0) return [];
  const { data } = await db.from('profiles')
    .select('id,user_id,email,display_name,role,is_producer')
    .in('user_id', userIds);
  return ((data ?? []) as any[]).map(rowToParty);
}

// ── recipient search (matrix-scoped picker) ───────────────────────────────────

/**
 * Search recipients the sender is ALLOWED to message. Staff + producers search
 * everyone; plain artists only see staff + producers (so the picker can never
 * even offer an artist→artist thread).
 */
export async function searchRecipients(db: Client, sender: Party, q: string): Promise<Party[]> {
  const needle = q.trim().replace(/[%_]/g, '');
  if (needle.length < 2) return [];
  const { data } = await db.from('profiles')
    .select('id,user_id,email,display_name,role,is_producer')
    .or(`display_name.ilike.%${needle}%,email.ilike.%${needle}%`)
    .not('email', 'is', null)
    .limit(40);
  const parties = ((data ?? []) as any[]).map(rowToParty)
    .filter((p) => p.userId !== sender.userId)
    .filter((p) => canDirectMessageAll(sender, [p]).allowed);
  return parties.slice(0, 12);
}

// ── DM threads ────────────────────────────────────────────────────────────────

/**
 * Find-or-create a direct thread. 1:1 pairs ALWAYS reuse (legacy producer_dm
 * threads count as the same conversation); groups create fresh. The caller has
 * already passed the matrix — this function only persists.
 */
export async function findOrCreateDmThread(db: Client, sender: Party, targets: Party[]):
  Promise<{ threadId: string; reused: boolean }> {
  if (targets.length === 1) {
    const a = sender.userId, b = targets[0].userId;
    const [{ data: mine }, { data: theirs }] = await Promise.all([
      db.from('message_thread_participants').select('thread_id').eq('user_id', a),
      db.from('message_thread_participants').select('thread_id').eq('user_id', b),
    ]);
    const theirSet = new Set(((theirs ?? []) as any[]).map((r) => r.thread_id));
    const shared = ((mine ?? []) as any[]).map((r) => r.thread_id).filter((id) => theirSet.has(id));
    if (shared.length > 0) {
      // Only true pair threads (exactly 2 participants) of a DM kind qualify.
      const { data: threads } = await db.from('message_threads')
        .select('id,kind,last_message_at').in('id', shared)
        .in('kind', DM_KINDS as unknown as string[])
        .order('last_message_at', { ascending: false });
      for (const t of (threads ?? []) as any[]) {
        const { count } = await db.from('message_thread_participants')
          .select('user_id', { count: 'exact', head: true }).eq('thread_id', t.id);
        if (count === 2) return { threadId: t.id, reused: true };
      }
    }
  }

  const subject = targets.length === 1
    ? `${sender.name} ↔ ${targets[0].name}`
    : `${sender.name} + ${targets.map((t) => t.name).join(', ')}`;
  const { data: created, error } = await db.from('message_threads')
    .insert({ kind: 'dm', subject } as never).select('id').single();
  if (error || !created) throw new Error(`dm thread insert: ${error?.message}`);
  const threadId = (created as any).id as string;

  const rows = [sender, ...targets].map((p) => ({
    thread_id: threadId, user_id: p.userId, role: participantRoleFor(p),
  }));
  const { error: pErr } = await db.from('message_thread_participants').insert(rows as never);
  if (pErr) throw new Error(`dm participants insert: ${pErr.message}`);
  return { threadId, reused: false };
}

// ── studio thread (per-user front desk) ───────────────────────────────────────

/** Find-or-create the user's studio thread (DB kind 'sweet_dreams'). */
export async function getOrCreateStudioThread(db: Client, userId: string): Promise<string | null> {
  const { data: existing } = await db.from('message_threads')
    .select('id').eq('kind', STUDIO_KIND).eq('owner_user_id', userId).maybeSingle();
  if (existing) return (existing as any).id;
  const { data: created, error } = await db.from('message_threads')
    .insert({ kind: STUDIO_KIND, owner_user_id: userId, subject: 'Sweet Dreams Music' } as never)
    .select('id').single();
  if (error || !created) {
    console.error('[messaging] could not create studio thread for', userId, error?.message);
    return null;
  }
  await db.from('message_thread_participants').insert({
    thread_id: (created as any).id, user_id: userId, role: 'owner',
  } as never);
  return (created as any).id;
}

// ── "their own clients" resolvers ─────────────────────────────────────────────

// bookings.engineer_name is free TEXT and one human appears under several
// strings over time. Mirrors lib/earnings-core's NAME_MAP aliases (kept there
// for payroll; duplicated proper-case here because bookings .in() matching is
// case-sensitive). Historical aliases MUST stay forever — the Zion-rename lesson.
const LEGACY_ENGINEER_ALIASES: Record<string, string[]> = {
  Zion: ['Zion Omari', 'Zion Tinsley'],
};

async function engineerAliasSet(db: Client, sender: Party): Promise<string[]> {
  const aliases = new Set<string>();
  if (sender.name) aliases.add(sender.name);
  const { data: roster } = await db.from('engineers')
    .select('name,display_name').ilike('email', sender.email).maybeSingle();
  if (roster) {
    if ((roster as any).name) aliases.add((roster as any).name);
    if ((roster as any).display_name) aliases.add((roster as any).display_name);
    for (const canonical of [(roster as any).name, (roster as any).display_name]) {
      for (const legacy of LEGACY_ENGINEER_ALIASES[canonical as string] ?? []) aliases.add(legacy);
    }
  }
  return Array.from(aliases).filter(Boolean);
}

/** All profiles, mapped by lowercased email (150 rows — fine to load whole). */
async function profilesByEmail(db: Client): Promise<Map<string, { userId: string; email: string }>> {
  const { data } = await db.from('profiles').select('user_id,email').not('email', 'is', null);
  const map = new Map<string, { userId: string; email: string }>();
  for (const p of (data ?? []) as any[]) {
    map.set(String(p.email).toLowerCase(), { userId: p.user_id, email: p.email });
  }
  return map;
}

/** Engineer → users they have run (non-cancelled) sessions for. Recomputed at send time. */
export async function engineerClientUserIds(db: Client, sender: Party): Promise<string[]> {
  const aliases = await engineerAliasSet(db, sender);
  if (aliases.length === 0) return [];
  const { data: rows } = await db.from('bookings')
    .select('customer_email').in('engineer_name', aliases)
    .neq('status', 'cancelled').is('deleted_at', null);
  const emails = new Set(((rows ?? []) as any[])
    .map((b) => String(b.customer_email || '').toLowerCase()).filter(Boolean));
  const byEmail = await profilesByEmail(db);
  const ids = new Set<string>();
  for (const e of emails) {
    if (TEST_EMAILS.has(e)) continue;
    const hit = byEmail.get(e);
    if (hit && hit.userId !== sender.userId) ids.add(hit.userId);
  }
  return Array.from(ids);
}

/** Producer → buyers of their beats (beats.producer_id = profiles.id; buyer_id
 *  nullable — guests resolve via lowercased buyer_email). */
export async function producerBuyerUserIds(db: Client, sender: Party): Promise<string[]> {
  const { data: beats } = await db.from('beats').select('id').eq('producer_id', sender.profileId);
  const beatIds = ((beats ?? []) as any[]).map((b) => b.id);
  if (beatIds.length === 0) return [];
  const { data: purchases } = await db.from('beat_purchases')
    .select('buyer_id,buyer_email').in('beat_id', beatIds);
  const byEmail = await profilesByEmail(db);
  const ids = new Set<string>();
  for (const p of (purchases ?? []) as any[]) {
    if (p.buyer_id) { ids.add(p.buyer_id); continue; }
    const hit = byEmail.get(String(p.buyer_email || '').toLowerCase());
    if (hit) ids.add(hit.userId);
  }
  ids.delete(sender.userId);
  return Array.from(ids);
}

/** Media manager → customers of media bookings they have sessions on. */
export async function mediaClientUserIds(db: Client, sender: Party): Promise<string[]> {
  const { data: sessions } = await db.from('media_session_bookings')
    .select('parent_booking_id').eq('engineer_id', sender.userId);
  const bookingIds = Array.from(new Set(((sessions ?? []) as any[])
    .map((s) => s.parent_booking_id).filter(Boolean)));
  if (bookingIds.length === 0) return [];
  const { data: bookings } = await db.from('media_bookings')
    .select('user_id').in('id', bookingIds);
  const ids = new Set(((bookings ?? []) as any[]).map((b) => b.user_id).filter(Boolean));
  ids.delete(sender.userId);
  return Array.from(ids) as string[];
}

// ── broadcast audiences ───────────────────────────────────────────────────────

export interface Audience { userIds: string[]; segment: BroadcastSegment }

/**
 * Resolve a broadcast segment to concrete user ids, AT SEND TIME, server-side.
 * Test accounts are always excluded. The caller has already passed canBroadcast.
 */
export async function resolveAudience(db: Client, sender: Party, segment: BroadcastSegment): Promise<Audience> {
  const allProfiles = async () => {
    const { data } = await db.from('profiles')
      .select('id,user_id,email,display_name,role,is_producer').not('email', 'is', null);
    return ((data ?? []) as any[]).map(rowToParty)
      .filter((p) => p.email && !TEST_EMAILS.has(p.email.toLowerCase()));
  };

  let userIds: string[] = [];
  switch (segment) {
    case 'everyone':
      userIds = (await allProfiles()).map((p) => p.userId);
      break;
    case 'all_artists':
      userIds = (await allProfiles()).filter((p) => p.role === 'user' && !p.isProducer).map((p) => p.userId);
      break;
    case 'all_engineers':
      userIds = (await allProfiles()).filter((p) => p.role === 'engineer').map((p) => p.userId);
      break;
    case 'all_producers':
      userIds = (await allProfiles()).filter((p) => p.isProducer).map((p) => p.userId);
      break;
    case 'active_90d': {
      // artist_tracking_status (075): paid activity in the last 90 days.
      const { data } = await db.from('artist_tracking_status')
        .select('user_id,email,is_active').eq('is_active', true);
      userIds = ((data ?? []) as any[])
        .filter((r) => r.email && !TEST_EMAILS.has(String(r.email).toLowerCase()))
        .map((r) => r.user_id);
      break;
    }
    case 'upcoming_sessions': {
      const { data: rows } = await db.from('bookings')
        .select('customer_email').gte('start_time', new Date().toISOString())
        .not('status', 'in', '("cancelled","rejected","deleted")').is('deleted_at', null);
      const emails = new Set(((rows ?? []) as any[])
        .map((b) => String(b.customer_email || '').toLowerCase()).filter((e) => e && !TEST_EMAILS.has(e)));
      const byEmail = await profilesByEmail(db);
      userIds = Array.from(emails).map((e) => byEmail.get(e)?.userId).filter(Boolean) as string[];
      break;
    }
    case 'beat_buyers': {
      const { data: purchases } = await db.from('beat_purchases').select('buyer_id,buyer_email');
      const byEmail = await profilesByEmail(db);
      const ids = new Set<string>();
      for (const p of (purchases ?? []) as any[]) {
        if (p.buyer_id) ids.add(p.buyer_id);
        else {
          const hit = byEmail.get(String(p.buyer_email || '').toLowerCase());
          if (hit) ids.add(hit.userId);
        }
      }
      const parties = await resolveParties(db, Array.from(ids));
      userIds = parties.filter((p) => p.email && !TEST_EMAILS.has(p.email.toLowerCase())).map((p) => p.userId);
      break;
    }
    case 'my_clients':
      userIds = sender.role === 'media_manager'
        ? await mediaClientUserIds(db, sender)
        : await engineerClientUserIds(db, sender);
      break;
    case 'my_buyers':
      userIds = await producerBuyerUserIds(db, sender);
      break;
  }
  return { userIds: Array.from(new Set(userIds)), segment };
}

// ── broadcast fan-out ─────────────────────────────────────────────────────────

/**
 * Deliver a broadcast into each recipient's studio thread: one ordinary message
 * per user, attributed to the sender, tagged with the audit row id. Replies are
 * just normal studio-thread conversation — no special handling.
 */
export async function broadcastFanOut(db: Client, args: {
  sender: Party;
  subject: string;
  body: string;
  userIds: string[];
  broadcastId: string | null;
}): Promise<{ delivered: number; failed: number }> {
  let delivered = 0, failed = 0;
  const text = args.subject ? `${args.subject}\n\n${args.body}` : args.body;
  for (const userId of args.userIds) {
    try {
      const threadId = await getOrCreateStudioThread(db, userId);
      if (!threadId) { failed++; continue; }
      const { error } = await db.from('messages').insert({
        thread_id: threadId,
        author_user_id: args.sender.userId,
        author_role: authorRoleFor(args.sender),
        kind: 'update',
        body: text,
        attachments: [],
        broadcast_id: args.broadcastId,
      } as never);
      if (error) { failed++; continue; }
      delivered++;
    } catch {
      failed++;
    }
  }
  return { delivered, failed };
}

// ── unread nudge sweep ────────────────────────────────────────────────────────

export interface NudgeCandidate {
  threadId: string; email: string; name: string; preview: string;
}

/**
 * One email per thread per unread burst: threads whose last message is a CHAT
 * (mirrors/notifications already emailed) older than 24h, where a participant
 * hasn't read it. Studio threads nudge ONLY the owner (staff awareness is the
 * support queue's job); DM threads nudge every unread participant. last_nudge_at
 * on the thread caps it — never re-nudged until a NEWER message arrives.
 */
export async function sweepUnreadNudges(
  db: Client,
  send: (to: string, details: { name: string; threadId: string; preview: string }) => Promise<void>,
): Promise<{ scanned: number; nudged: number }> {
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const { data: threads, error } = await db.from('message_threads')
    .select('id,kind,owner_user_id,last_message_at,last_nudge_at')
    .lte('last_message_at', dayAgo)
    .gte('last_message_at', twoWeeksAgo)
    .in('kind', [STUDIO_KIND, 'dm', 'producer_dm'])
    .limit(500);
  if (error) {
    console.error('[messaging] nudge scan failed:', error.message);
    return { scanned: 0, nudged: 0 };
  }

  let nudged = 0;
  const candidates = ((threads ?? []) as any[]).filter((t) =>
    !t.last_nudge_at || new Date(t.last_nudge_at) < new Date(t.last_message_at));

  for (const t of candidates) {
    try {
      const { data: last } = await db.from('messages')
        .select('author_user_id,author_role,kind,body,created_at')
        .eq('thread_id', t.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!last || (last as any).kind !== 'chat') continue; // system mirrors already emailed

      const { data: participants } = await db.from('message_thread_participants')
        .select('user_id,last_read_at').eq('thread_id', t.id);
      let unread = ((participants ?? []) as any[]).filter((p) =>
        p.user_id !== (last as any).author_user_id
        && new Date(p.last_read_at) < new Date(t.last_message_at));
      if (t.kind === STUDIO_KIND) {
        unread = unread.filter((p) => p.user_id === t.owner_user_id);
      }
      if (unread.length === 0) continue;

      const parties = await resolveParties(db, unread.map((p) => p.user_id));
      const preview = String((last as any).body || 'New message').slice(0, 140);
      let sent = false;
      for (const p of parties) {
        if (!p.email || TEST_EMAILS.has(p.email.toLowerCase())) continue;
        await send(p.email, { name: p.name, threadId: t.id, preview });
        sent = true;
      }
      if (sent) {
        await db.from('message_threads').update({ last_nudge_at: new Date().toISOString() } as never).eq('id', t.id);
        nudged++;
      }
    } catch (e) {
      console.error('[messaging] nudge failed for thread', t.id, e);
    }
  }
  return { scanned: candidates.length, nudged };
}
