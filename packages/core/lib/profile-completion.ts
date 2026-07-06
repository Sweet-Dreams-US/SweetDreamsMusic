// lib/profile-completion.ts — canonical profile-completion definition + compute.
//
// PURE module: no DB, no next/headers, no network. Importable from BOTH the
// client (the Hub completion checklist) AND the server (the reward trigger that
// grants the "complete your profile" reward). Keeping the definition and the
// math in one pure place is the whole point — the checklist a user sees and the
// gate that fires the reward MUST agree byte-for-byte, so they call the same
// function with the same inputs.
//
// The caller is responsible for assembling the input (e.g. counting unified
// social links via lib/social-links-server). This module only decides what
// "complete" means and computes it.

/**
 * A single required profile-completion item.
 * - `key` is stable and machine-readable (used as a React key, for analytics,
 *   and to look an item up); never change an existing key.
 * - `label` is the human-facing checklist label.
 */
export interface ProfileCompletionItemDef {
  key: string;
  label: string;
}

/**
 * The canonical, ordered list of REQUIRED profile-completion items.
 *
 * Order here is the order the Hub checklist renders. All six must be done for a
 * profile to count as complete. Genres requires >=1; social links requires >=4
 * connected platforms; the rest require a non-empty value.
 *
 * NOTE: "social links" and the metrics-tracker "connected platforms" are the SAME
 * thing — both are rows in platform_connections (see lib/social-links-server).
 * The label reflects that; the requirement is >=4 platforms in the metrics tracker.
 */
export const PROFILE_COMPLETION_ITEMS: readonly ProfileCompletionItemDef[] = [
  { key: 'display_name', label: 'Display name' },
  { key: 'profile_picture_url', label: 'Profile photo' },
  { key: 'cover_photo_url', label: 'Cover photo' },
  { key: 'bio', label: 'Bio' },
  { key: 'genres', label: 'Genres' },
  // key stays 'social_links' (stable, never rename); label makes the unification
  // with the metrics tracker explicit.
  { key: 'social_links', label: 'Connected platforms' },
] as const;

/** Minimum number of genres for the `genres` item to be done. */
export const MIN_GENRES = 1;
/** Minimum number of connected platforms (social links == metrics-tracker
 *  platforms, both rows in platform_connections) for `social_links` to be done. */
export const MIN_SOCIAL_LINKS = 4;

/**
 * Input to {@link computeProfileCompletion}. Every field is optional /
 * nullable so a partially-loaded or partially-filled profile is valid input —
 * a missing field simply counts as "not done".
 *
 * - `genres` is the artist's selected genres (length checked against MIN_GENRES).
 * - `socialLinkCount` is the count of UNIFIED social links (i.e. rows in
 *   platform_connections) — assemble it with
 *   getUnifiedSocialLinks() from lib/social-links-server before calling here.
 */
export interface ProfileCompletionInput {
  display_name?: string | null;
  profile_picture_url?: string | null;
  cover_photo_url?: string | null;
  bio?: string | null;
  genres?: string[] | null;
  socialLinkCount?: number | null;
}

/** A computed completion item: the def plus whether it's satisfied + its rule. */
export interface ProfileCompletionItem {
  key: string;
  label: string;
  /** Whether this required item is satisfied for the given input. */
  done: boolean;
  /** Short human description of what's required (e.g. "Connect 3+ platforms"). */
  requirementText: string;
}

/** The full result of computing profile completion. */
export interface ProfileCompletionResult {
  /** One entry per required item, in canonical order. */
  items: ProfileCompletionItem[];
  /** How many required items are done. */
  requiredDone: number;
  /** Total required items (always PROFILE_COMPLETION_ITEMS.length). */
  requiredTotal: number;
  /** Integer 0–100, rounded: requiredDone / requiredTotal. */
  percent: number;
  /** True iff every required item is done. */
  complete: boolean;
}

/** A non-empty, non-whitespace string. */
function hasText(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Per-item requirement copy, keyed by item key. */
const REQUIREMENT_TEXT: Record<string, string> = {
  display_name: 'Add a display name',
  profile_picture_url: 'Upload a profile photo',
  cover_photo_url: 'Upload a cover photo',
  bio: 'Write a short bio',
  genres: `Pick at least ${MIN_GENRES} genre`,
  social_links: `Connect ${MIN_SOCIAL_LINKS}+ platforms in your metrics tracker`,
};

/**
 * Compute profile completion for the given input.
 *
 * PURE and deterministic — same input always yields the same result, with no
 * side effects. The reward trigger (server) and the Hub checklist (client) both
 * call this so they can never disagree about whether a profile is "complete".
 *
 * `complete` is true iff EVERY required item is done:
 *   - display_name / profile_picture_url / cover_photo_url / bio: non-empty
 *     (whitespace-only does not count)
 *   - genres: at least MIN_GENRES (default 1)
 *   - social_links: socialLinkCount >= MIN_SOCIAL_LINKS (default 4)
 */
export function computeProfileCompletion(
  input: ProfileCompletionInput,
): ProfileCompletionResult {
  const genreCount = Array.isArray(input.genres) ? input.genres.length : 0;
  const socialCount =
    typeof input.socialLinkCount === 'number' ? input.socialLinkCount : 0;

  const doneByKey: Record<string, boolean> = {
    display_name: hasText(input.display_name),
    profile_picture_url: hasText(input.profile_picture_url),
    cover_photo_url: hasText(input.cover_photo_url),
    bio: hasText(input.bio),
    genres: genreCount >= MIN_GENRES,
    social_links: socialCount >= MIN_SOCIAL_LINKS,
  };

  const items: ProfileCompletionItem[] = PROFILE_COMPLETION_ITEMS.map((def) => ({
    key: def.key,
    label: def.label,
    done: !!doneByKey[def.key],
    requirementText: REQUIREMENT_TEXT[def.key] ?? '',
  }));

  const requiredTotal = items.length;
  const requiredDone = items.filter((i) => i.done).length;
  const percent =
    requiredTotal === 0 ? 0 : Math.round((requiredDone / requiredTotal) * 100);
  const complete = requiredDone === requiredTotal;

  return { items, requiredDone, requiredTotal, percent, complete };
}
