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
