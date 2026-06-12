/**
 * Ownership checks for engineer-scoped write operations on bookings.
 *
 * Before an engineer (non-admin) mutates a booking — recording cash,
 * adjusting balance, marking complete, etc. — we must confirm that the
 * booking's `engineer_name` actually matches this engineer. Otherwise
 * any engineer could record fraudulent cash against a peer's session.
 *
 * Admins (`SUPER_ADMINS`) always pass.
 *
 * Matching tolerates the three shapes engineer_name can take on older rows:
 *   - ENGINEERS[].name       (e.g. "Iszac Griner")
 *   - ENGINEERS[].displayName (e.g. "Iszac")
 *   - profiles.display_name   (whatever the engineer set)
 */

import { ENGINEERS, SUPER_ADMINS } from './constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface OwnershipCheck {
  ownsBooking: boolean;
  isAdmin: boolean;
  actorEmail: string | null;
  // The set of names that resolved to this actor (for logging).
  matchedNames: string[];
}

/**
 * Returns whether the authenticated user may mutate `booking.engineer_name`-
 * scoped fields. Super-admins always pass.
 */
export async function checkBookingOwnership(
  supabase: SupabaseClient,
  bookingEngineerName: string | null | undefined
): Promise<OwnershipCheck> {
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? null;

  const isAdmin = !!email && (SUPER_ADMINS as readonly string[]).includes(email);

  if (isAdmin) {
    return { ownsBooking: true, isAdmin: true, actorEmail: email, matchedNames: [] };
  }

  if (!bookingEngineerName || !email || !user?.id) {
    return { ownsBooking: false, isAdmin: false, actorEmail: email, matchedNames: [] };
  }

  const matchedNames: string[] = [];

  // Match by email → engineer config → name / displayName.
  const cfg = ENGINEERS.find(e => e.email.toLowerCase() === email);
  if (cfg) {
    if (cfg.name === bookingEngineerName) matchedNames.push(cfg.name);
    if (cfg.displayName === bookingEngineerName) matchedNames.push(cfg.displayName);
  }

  // Fallback: look up the engineer's profile display_name.
  if (matchedNames.length === 0) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profile?.display_name && profile.display_name === bookingEngineerName) {
      matchedNames.push(profile.display_name);
    }
  }

  return {
    ownsBooking: matchedNames.length > 0,
    isAdmin: false,
    actorEmail: email,
    matchedNames,
  };
}
