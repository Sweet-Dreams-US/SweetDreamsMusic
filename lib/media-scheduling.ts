// lib/media-scheduling.ts
//
// Pure types + helpers for the media-session scheduling layer (Phase D).
// Imported by both the client scheduler form and the server conflict-check
// route. NO Supabase, NO `next/headers`, NO secrets in this file.
//
// Server-only DB queries live in `lib/media-scheduling-server.ts`.
//
// Spec: SweetDreamsMusicVault/Features/Media-Booking-Hub.md
import { fmtStampDateTime, fmtStampTime } from '@/lib/studio-time';

// ============================================================
// Domain types — mirror media_session_bookings in 039_media_hub.sql
// ============================================================

export type MediaSessionKind =
  | 'video'
  | 'photo'
  | 'recording'
  | 'mixing'
  | 'storyboard'
  | 'marketing-meeting'
  | 'planning_call'
  | 'other';

export type MediaSessionLocation = 'studio' | 'external';

export type MediaSessionStatus =
  | 'requested' // Phase 5: artist asked, awaiting media-team confirm
  | 'proposed'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'superseded';

/** Display labels for the kind selector. */
export const SESSION_KIND_LABELS: Record<MediaSessionKind, string> = {
  video: 'Video shoot',
  photo: 'Photo shoot',
  recording: 'Recording session',
  mixing: 'Mixing session',
  storyboard: 'Storyboard / planning',
  'marketing-meeting': 'Marketing meeting',
  planning_call: 'Planning call',
  other: 'Other',
};

// ============================================================
// 48-hour minimum lead time for media shoot requests (Phase 5)
// ============================================================
// Cole's rule: no media shoot can be booked less than two days out — the
// team needs lead time to plan. media_session_bookings.starts_at is a true
// UTC instant, so a plain Date.now() comparison is correct (no studio-local
// gymnastics needed for the math; display still goes through fmtStamp*).

export const MEDIA_MIN_LEAD_MS = 48 * 60 * 60 * 1000;

/** True if `startsAt` is sooner than 48h from now (i.e. should be rejected). */
export function violates48hLead(startsAt: string | Date, now: Date = new Date()): boolean {
  const start = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  if (Number.isNaN(start.getTime())) return true; // unparseable → reject
  return start.getTime() - now.getTime() < MEDIA_MIN_LEAD_MS;
}

/** Full row shape from `media_session_bookings`. */
export interface MediaSessionBooking {
  id: string;
  parent_booking_id: string;
  starts_at: string;
  ends_at: string;
  location: MediaSessionLocation;
  external_location_text: string | null;
  engineer_id: string;
  session_kind: MediaSessionKind;
  status: MediaSessionStatus;
  split_breakdown: unknown | null;
  engineer_payout_cents: number | null;
  engineer_payout_paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Conflict-detection types
// ============================================================

/**
 * A "busy window" describes any pre-existing commitment that would conflict
 * with a proposed media session. Both studio bookings and existing media
 * sessions get normalized into this shape so the conflict check is uniform.
 *
 * `source` lets the error message tell the buyer *what* the conflict is —
 * an existing studio session or another media shoot — without leaking row
 * IDs from internal tables.
 */
export interface BusyWindow {
  startsAt: string; // ISO
  endsAt: string;   // ISO
  source: 'studio_booking' | 'media_session';
  label: string;    // human-readable, e.g. "Recording — Iszac, 6:00–9:00 PM"
}

/**
 * The proposed session being checked. We accept a flat shape (not the full
 * row) so the API can validate-before-insert without partially constructing
 * a row.
 */
export interface ProposedSession {
  startsAt: string;
  endsAt: string;
  engineerId: string;
  location: MediaSessionLocation;
}

// ============================================================
// Pure overlap helpers
// ============================================================

/**
 * Standard half-open interval overlap test:
 *   [aStart, aEnd) overlaps [bStart, bEnd)  iff  aStart < bEnd  AND  bStart < aEnd
 *
 * Half-open means "ends_at is exclusive" — back-to-back sessions
 * (one ends 6:00, next starts 6:00) are NOT a conflict, which matches
 * how engineers actually transition between sessions.
 */
export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Find the FIRST busy window that overlaps the proposed session, or null
 * if the slot is clean. We return the conflict (not just true/false) so
 * the API can surface a useful error like "Iszac is in studio that night
 * 6–9pm — pick a different time or engineer."
 */
export function findOverlap(
  proposed: Pick<ProposedSession, 'startsAt' | 'endsAt'>,
  busy: BusyWindow[],
): BusyWindow | null {
  const ps = new Date(proposed.startsAt);
  const pe = new Date(proposed.endsAt);
  for (const w of busy) {
    if (rangesOverlap(ps, pe, new Date(w.startsAt), new Date(w.endsAt))) {
      return w;
    }
  }
  return null;
}

// ============================================================
// Validation — used by the API before doing the conflict query
// ============================================================

/**
 * Ensure the proposed window is at least sane: well-formed timestamps,
 * end-after-start, reasonable duration. Returns an error string or null.
 *
 * We're permissive about "in the past" — admin might back-date a session
 * that already happened (rare but possible). The buyer-facing form has
 * its own UI-level minimum (must be ≥1hr in the future) but that's a
 * UX rule, not a data rule.
 */
export function validateProposed(
  p: Pick<ProposedSession, 'startsAt' | 'endsAt' | 'engineerId'>,
): string | null {
  const start = new Date(p.startsAt);
  const end = new Date(p.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Invalid date/time';
  }
  if (end <= start) {
    return 'End time must be after start time';
  }
  const durationHours = (end.getTime() - start.getTime()) / 1000 / 60 / 60;
  if (durationHours > 24) {
    return 'Sessions cannot exceed 24 hours — split into multiple bookings';
  }
  if (durationHours < 0.25) {
    return 'Sessions must be at least 15 minutes';
  }
  if (!p.engineerId) {
    return 'Engineer required';
  }
  return null;
}

/**
 * Format a window for the busy-window label. Used by both the conflict-check
 * server and the scheduler's "your existing sessions" sidebar.
 *
 * media_session_bookings.starts_at / ends_at are true-UTC instants
 * (client calls new Date(...).toISOString() before POSTing) — use fmtStamp*.
 */
export function formatWindowLabel(
  startsAt: string,
  endsAt: string,
  prefix: string,
): string {
  const startLabel = fmtStampDateTime(startsAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const endLabel = fmtStampTime(endsAt, { hour: 'numeric', minute: '2-digit' });
  return `${prefix} · ${startLabel} – ${endLabel}`;
}
