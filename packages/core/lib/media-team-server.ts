// lib/media-team-server.ts
//
// Server-only helpers for the media team (media managers). NEVER import from
// client components — uses the Supabase server/service client.
//
// Media managers are DB-driven: identified by profiles.role = 'media_manager',
// with identity resolved from the profile (display_name / email). There is NO
// hardcoded roster (unlike ENGINEERS in lib/constants.ts). This is deliberate
// — it's the template for eventually migrating engineers off their hardcoded
// roster too (Cole's "all employees admin-manageable" goal).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface MediaManager {
  user_id: string;
  display_name: string | null;
  email: string | null;
}

/**
 * Everyone with the media_manager role. Used to fan out "new media request"
 * notifications (parallel to how the booking webhook emails all studio
 * engineers) and to resolve manager identity for display/payout.
 *
 * Pass a service client when calling from a context that must bypass RLS
 * (e.g. the Stripe webhook or a cron); an authed client is fine from routes
 * that have already verified the caller.
 */
export async function getMediaManagers(client: SupabaseClient): Promise<MediaManager[]> {
  const { data, error } = await client
    .from('profiles')
    .select('user_id, display_name, email')
    .eq('role', 'media_manager');
  if (error) {
    console.error('[media-team] getMediaManagers failed:', error.message);
    return [];
  }
  return (data ?? []) as MediaManager[];
}

/** Just the media managers' emails (for notification recipient lists). */
export async function getMediaManagerEmails(client: SupabaseClient): Promise<string[]> {
  const managers = await getMediaManagers(client);
  return managers
    .map((m) => m.email)
    .filter((e): e is string => typeof e === 'string' && e.length > 0);
}

export interface MediaTeamJob {
  id: string;
  status: string;
  session_kind: string;
  location: string;
  external_location_text: string | null;
  starts_at: string;
  ends_at: string;
  vision: string | null;
  notes: string | null;
  media_credit_id: string | null;
  credit_kind: string | null;
  credit_tier: string | null;
  parent_booking_id: string | null;
  requested_by: string | null;
  requester_name: string | null;
  requester_email: string | null;
  media_manager_id: string | null;
  manager_name: string | null;
  confirmed_at: string | null;
  created_at: string;
}

/**
 * The media team's shared job queue (Phase 5). Returns ALL media sessions in
 * the request flow (or only unclaimed requests when `unclaimedOnly`), hydrated
 * with requester + assigned-manager display names and the source credit kind/
 * tier — so cards render without N+1 lookups. Team-wide by design: every media
 * manager sees every job, with the assigned manager shown per card.
 *
 * Pass a service client (routes call this after verifyMediaManagerAccess).
 */
export async function getMediaTeamJobs(
  client: SupabaseClient,
  opts: { unclaimedOnly?: boolean } = {},
): Promise<MediaTeamJob[]> {
  let q = client
    .from('media_session_bookings')
    .select('id, status, session_kind, location, external_location_text, starts_at, ends_at, vision, notes, media_credit_id, parent_booking_id, requested_by, media_manager_id, confirmed_at, created_at')
    .order('starts_at', { ascending: true });

  if (opts.unclaimedOnly) {
    q = q.eq('status', 'requested').is('media_manager_id', null);
  } else {
    // The team's working set: anything in the request lifecycle. Exclude the
    // legacy offering/proposal rows that were never part of this flow by
    // requiring a credit link OR an assigned manager OR 'requested' status.
    q = q.not('status', 'in', '(superseded)');
  }

  const { data: rows, error } = await q;
  if (error) {
    console.error('[media-team] getMediaTeamJobs failed:', error.message);
    return [];
  }
  const sessions = (rows ?? []) as Array<Record<string, unknown>>;
  if (sessions.length === 0) return [];

  // Batch-hydrate profiles (requester + manager) and credits.
  const userIds = Array.from(new Set(
    sessions.flatMap((r) => [r.requested_by, r.media_manager_id]).filter((v): v is string => typeof v === 'string'),
  ));
  const creditIds = Array.from(new Set(
    sessions.map((r) => r.media_credit_id).filter((v): v is string => typeof v === 'string'),
  ));

  const [profilesRes, creditsRes] = await Promise.all([
    userIds.length
      ? client.from('profiles').select('user_id, display_name, email').in('user_id', userIds)
      : Promise.resolve({ data: [] }),
    creditIds.length
      ? client.from('media_credits').select('id, credit_kind, tier').in('id', creditIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profById = new Map<string, { display_name: string | null; email: string | null }>(
    ((profilesRes.data ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>)
      .map((p) => [p.user_id, { display_name: p.display_name, email: p.email }]),
  );
  const creditById = new Map<string, { credit_kind: string; tier: string | null }>(
    ((creditsRes.data ?? []) as Array<{ id: string; credit_kind: string; tier: string | null }>)
      .map((c) => [c.id, { credit_kind: c.credit_kind, tier: c.tier }]),
  );

  return sessions.map((r): MediaTeamJob => {
    const requester = r.requested_by ? profById.get(r.requested_by as string) : null;
    const manager = r.media_manager_id ? profById.get(r.media_manager_id as string) : null;
    const credit = r.media_credit_id ? creditById.get(r.media_credit_id as string) : null;
    return {
      id: r.id as string,
      status: r.status as string,
      session_kind: r.session_kind as string,
      location: r.location as string,
      external_location_text: (r.external_location_text as string | null) ?? null,
      starts_at: r.starts_at as string,
      ends_at: r.ends_at as string,
      vision: (r.vision as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      media_credit_id: (r.media_credit_id as string | null) ?? null,
      credit_kind: credit?.credit_kind ?? null,
      credit_tier: credit?.tier ?? null,
      parent_booking_id: (r.parent_booking_id as string | null) ?? null,
      requested_by: (r.requested_by as string | null) ?? null,
      requester_name: requester?.display_name ?? null,
      requester_email: requester?.email ?? null,
      media_manager_id: (r.media_manager_id as string | null) ?? null,
      manager_name: manager?.display_name ?? null,
      confirmed_at: (r.confirmed_at as string | null) ?? null,
      created_at: r.created_at as string,
    };
  });
}
