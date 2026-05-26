// lib/events.ts
//
// Client-safe events module — TypeScript types + pure helpers.
//
// Same import rule as lib/bands.ts: NO `next/headers`, NO service client,
// NO server-only code. Client components import types and pure helpers from
// here; async DB queries live in `@/lib/events-server`.

// ============================================================
// Types
// ============================================================

/**
 * Three visibility states, matching the migration CHECK constraint.
 *
 *   public         — listed on /events, anyone can RSVP directly
 *   private_listed — listed on /events, visitors must request-to-attend
 *   private_hidden — NOT listed on /events, invitation-only
 */
export type EventVisibility = 'public' | 'private_listed' | 'private_hidden';

/**
 * RSVP lifecycle states. An RSVP row can transition between several of these
 * over its life (e.g. requested → going when an admin approves, invited →
 * going / not_going when the attendee responds).
 */
export type EventRsvpStatus = 'requested' | 'invited' | 'going' | 'maybe' | 'not_going';

export type SweetEvent = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  visibility: EventVisibility;
  capacity: number | null;
  is_cancelled: boolean;
  cancellation_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type EventRsvp = {
  id: string;
  event_id: string;
  user_id: string | null;
  invited_email: string | null;
  invited_by: string | null;
  status: EventRsvpStatus;
  token: string | null;
  message: string | null;
  guest_count: number;
  created_at: string;
  responded_at: string | null;
  /**
   * Optional profile snapshot for RSVPs with a `user_id`. Populated by the
   * admin GET handler (/api/admin/events/[id]) so admins reviewing the
   * roster can see who they're approving/denying without having to click
   * through to each user's profile separately. Token-only invites
   * (user_id = null) skip this — `invited_email` is the identity there.
   *
   * Optional everywhere else: the dashboard / user-facing RSVP loaders
   * don't bother filling it, so this field stays `undefined` for them.
   */
  profile?: EventRsvpProfile | null;
};

export type EventRsvpProfile = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  public_profile_slug: string | null;
};

/** Event + RSVP joined — used on user dashboards to show "events I'm going to". */
export type EventWithRsvp = {
  event: SweetEvent;
  rsvp: EventRsvp;
};

// ============================================================
// Visibility / listing checks
// ============================================================

/** Whether an event should appear on the public /events list. */
export function isEventListed(event: Pick<SweetEvent, 'visibility' | 'is_cancelled'>): boolean {
  if (event.is_cancelled) return false;
  return event.visibility === 'public' || event.visibility === 'private_listed';
}

/** Whether an anonymous visitor can RSVP directly (vs. must request/be invited). */
export function allowsDirectRsvp(event: Pick<SweetEvent, 'visibility'>): boolean {
  return event.visibility === 'public';
}

/** Whether a visitor can request-to-attend from the public detail page. */
export function allowsRequestToAttend(event: Pick<SweetEvent, 'visibility'>): boolean {
  return event.visibility === 'private_listed';
}

/** Whether the event is upcoming (starts in the future). Uses the caller's clock. */
export function isUpcoming(event: Pick<SweetEvent, 'starts_at'>, now: Date = new Date()): boolean {
  return new Date(event.starts_at) >= now;
}

// ============================================================
// Slug + token helpers (pure — no DB access)
// ============================================================

/**
 * Kebab-case an event title for use as a URL slug. Doesn't dedupe — pair with
 * `uniqueEventSlug` from `@/lib/events-server`.
 */
export function eventSlugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Opaque token for email-based RSVP invitations. Same construction as
 * band-invite tokens — 32 bytes, base64url.
 */
export function generateRsvpToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ============================================================
// Display helpers
// ============================================================

const VISIBILITY_LABELS: Record<EventVisibility, string> = {
  public: 'Public',
  private_listed: 'Private (listed · request to attend)',
  private_hidden: 'Private (hidden · invite-only)',
};

export function visibilityLabel(v: EventVisibility): string {
  return VISIBILITY_LABELS[v];
}

const STATUS_LABELS: Record<EventRsvpStatus, string> = {
  requested: 'Requested',
  invited: 'Invited',
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Not going',
};

export function rsvpStatusLabel(s: EventRsvpStatus): string {
  return STATUS_LABELS[s];
}
