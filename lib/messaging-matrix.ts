// lib/messaging-matrix.ts — THE permission matrix for messaging (Plan 4). Pure:
// no DB, no Next. Every messaging route gates through these two functions, and
// scripts/inbox-matrix-test.ts asserts every cell.
//
// | Sender         | Can open a thread with        | Can broadcast to            |
// |----------------|-------------------------------|-----------------------------|
// | Admin          | Anyone                        | Everyone or admin segments  |
// | Engineer       | Anyone                        | Their session clients       |
// | Media manager  | Anyone (staff)                | Their media clients         |
// | Producer       | Anyone                        | Buyers of their beats       |
// | Artist         | Staff + producers only        | Nobody                      |
//
// HARD RULE: no artist↔artist DMs — ever. The studio never moderates artist
// conversations because there are none. (media_manager wasn't in the plan's
// table; they're staff everywhere else in this app, so they get engineer-grade
// rights — flagged for Cole's review.)

import type { UserRole } from '@/lib/constants';

export interface MatrixParty {
  userId: string;
  role: UserRole;        // effective role (getUserRole output — admin = SUPER_ADMINS email)
  isProducer: boolean;   // profiles.is_producer — orthogonal to role
}

export const STAFF_ROLES: UserRole[] = ['admin', 'engineer', 'media_manager'];

export const isStaff = (p: { role: UserRole }) => STAFF_ROLES.includes(p.role);
/** Anyone with standing to initiate: staff or producer. Plain artists are not senders-at-large. */
export const isStaffOrProducer = (p: MatrixParty) => isStaff(p) || p.isProducer;

export interface MatrixVerdict { allowed: boolean; reason?: string }

/** May `sender` open (or post in) a direct thread with `target`? */
export function canDirectMessage(sender: MatrixParty, target: MatrixParty): MatrixVerdict {
  if (sender.userId === target.userId) {
    return { allowed: false, reason: 'You cannot message yourself.' };
  }
  // Staff and producers can reach anyone (the plan's "any user, staff, admins").
  if (isStaffOrProducer(sender)) return { allowed: true };
  // Plain artist: staff + producers only. Artist↔artist is the hard NO.
  if (isStaffOrProducer(target)) return { allowed: true };
  return {
    allowed: false,
    reason: 'Direct messages are for reaching the studio team and producers. Use your Studio thread for anything else.',
  };
}

/** May `sender` open a group thread with ALL of `targets`? Every pair must pass. */
export function canDirectMessageAll(sender: MatrixParty, targets: MatrixParty[]): MatrixVerdict {
  if (targets.length === 0) return { allowed: false, reason: 'Pick at least one recipient.' };
  if (targets.length > 6) return { allowed: false, reason: 'Group threads max out at 6 recipients.' };
  for (const t of targets) {
    const v = canDirectMessage(sender, t);
    if (!v.allowed) return v;
  }
  // A plain artist may not assemble a group containing another plain artist —
  // covered above since every target must be staff/producer for them.
  return { allowed: true };
}

// ── broadcasts ────────────────────────────────────────────────────────────────

export const ADMIN_SEGMENTS = [
  'everyone', 'all_artists', 'all_engineers', 'all_producers',
  'active_90d', 'upcoming_sessions', 'beat_buyers',
] as const;
export type AdminSegment = (typeof ADMIN_SEGMENTS)[number];

export const STAFF_SEGMENTS = ['my_clients', 'my_buyers'] as const;
export type StaffSegment = (typeof STAFF_SEGMENTS)[number];

export type BroadcastSegment = AdminSegment | StaffSegment;

export const SEGMENT_LABELS: Record<BroadcastSegment, string> = {
  everyone: 'Everyone',
  all_artists: 'All artists',
  all_engineers: 'All engineers',
  all_producers: 'All producers',
  active_90d: 'Active in last 90 days',
  upcoming_sessions: 'Upcoming sessions',
  beat_buyers: 'Beat buyers',
  my_clients: 'My clients',
  my_buyers: 'My beat buyers',
};

/** May `sender` broadcast to `segment`? */
export function canBroadcast(sender: MatrixParty, segment: string): MatrixVerdict {
  if (sender.role === 'admin') {
    return (ADMIN_SEGMENTS as readonly string[]).includes(segment)
      ? { allowed: true }
      : { allowed: false, reason: `Unknown segment: ${segment}` };
  }
  if (sender.role === 'engineer' || sender.role === 'media_manager') {
    return segment === 'my_clients'
      ? { allowed: true }
      : { allowed: false, reason: 'Engineers and media managers can only broadcast to their own clients.' };
  }
  if (sender.isProducer) {
    return segment === 'my_buyers'
      ? { allowed: true }
      : { allowed: false, reason: 'Producers can only broadcast to buyers of their beats.' };
  }
  return { allowed: false, reason: 'Artists cannot send broadcasts.' };
}

// ── shared kind semantics ─────────────────────────────────────────────────────

/** Generic-DM kinds: new threads are 'dm'; legacy 'producer_dm' rows read as synonyms. */
export const DM_KINDS = ['dm', 'producer_dm'] as const;

/** The per-user front-desk thread. DB kind string is frozen as 'sweet_dreams'
 *  (live prod code queries the literal); the UI labels it "Studio". */
export const STUDIO_KIND = 'sweet_dreams';

/** Author-role string for a message written by this party (messages.author_role). */
export function authorRoleFor(p: MatrixParty): 'admin' | 'engineer' | 'media_manager' | 'producer' | 'buyer' {
  if (p.role === 'admin') return 'admin';
  if (p.role === 'engineer') return 'engineer';
  if (p.role === 'media_manager') return 'media_manager';
  if (p.isProducer) return 'producer';
  return 'buyer';
}

/** Participant-role string for thread membership rows. */
export function participantRoleFor(p: MatrixParty): 'staff' | 'producer' | 'owner' {
  if (isStaff(p)) return 'staff';
  if (p.isProducer) return 'producer';
  return 'owner';
}
