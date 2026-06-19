// lib/media-contract-finalize.ts
//
// Media Projects — dual-signature CONTRACT FINALIZE.
//
// A media project contract requires TWO signatures:
//   • manager_agreed_at  — stamped when the manager hits "Send contract"
//                          (app/api/admin/media/bookings/[id]/send-contract)
//   • contract_agreed_at — stamped when the artist hits "Agree"
//                          (app/api/media/bookings/[id]/agree)
//
// Once BOTH are present, the project is FINAL. finalizeIfBothSigned() runs the
// one-time finalize side effects:
//
//   1. Materialize the planned_shoots[] the create flow stashed on
//      project_details into real media_session_bookings rows (status
//      'scheduled'). Studio shoots get a conflict check first (skip + warn on
//      conflict, never throw); external shoots are non-blocking.
//   2. Email both the artist and the manager: "signed by both parties — your
//      booking is final and on the calendar."
//   3. Stamp project_details.contract_finalized_at and advance the booking to a
//      schedulable status.
//
// IDEMPOTENT: guarded by project_details.contract_finalized_at — calling twice
// is a no-op. Safe to call from BOTH the agree route and the send-contract
// route (covers either signing order). Emails are fire-and-forget; a failed
// send never blocks or rolls back the finalize.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase/server';
import { ENGINEERS } from './constants';
import { studioInputToUtcISO } from './studio-time';
import {
  type MediaSessionKind,
  type MediaSessionLocation,
} from './media-scheduling';
import {
  checkMediaSessionConflict,
  getEngineerUserIdByName,
} from './media-scheduling-server';
import {
  sendMediaContractFinalized,
  type FinalizedSessionSummary,
} from './email';

// ============================================================
// planned_shoots — the shape the create flow stashes on project_details
// ============================================================
//
// project_details.planned_shoots: PlannedShoot[]
//
// Each entry describes one shoot the manager penciled in while building the
// contract. We DON'T create real sessions at create time — we wait until both
// parties sign, then materialize these into media_session_bookings.
//
// date         — 'YYYY-MM-DD' (studio-local / Eastern calendar date)
// start_time   — 'HH:MM'      (studio-local / Eastern wall clock, 24h)
// duration_hours — number     (session length; ends_at = start + duration)
// location     — 'studio' | 'external'
// external_location_text? — required-ish for external (free text)
// engineer_name? — display name from ENGINEERS; resolved to engineer_id
// session_kind?  — defaults to 'video'

export interface PlannedShoot {
  date: string;
  start_time: string;
  duration_hours: number;
  location: MediaSessionLocation;
  external_location_text?: string | null;
  engineer_name?: string | null;
  session_kind?: MediaSessionKind | null;
}

const VALID_KINDS: MediaSessionKind[] = [
  'video',
  'photo',
  'recording',
  'mixing',
  'storyboard',
  'marketing-meeting',
  'planning_call',
  'other',
];

/**
 * Compute the true-UTC starts_at/ends_at instants for a planned shoot.
 * planned_shoots carry Eastern wall-clock date + time; media_session_bookings
 * stores true-UTC instants, so we convert via studioInputToUtcISO (DST-aware).
 * Returns null if the date/time is malformed.
 */
function shootWindow(
  shoot: PlannedShoot,
): { startsAt: string; endsAt: string } | null {
  const date = String(shoot.date || '').trim();
  const time = String(shoot.start_time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}/.test(time)) return null;
  const startsAt = studioInputToUtcISO(`${date}T${time}`);
  if (!startsAt) return null;
  const hours = Number(shoot.duration_hours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const endsAt = new Date(
    new Date(startsAt).getTime() + hours * 60 * 60 * 1000,
  ).toISOString();
  return { startsAt, endsAt };
}

export interface FinalizeResult {
  finalized: boolean;            // true if we ran finalize side effects this call
  alreadyFinalized: boolean;     // true if contract_finalized_at was already set
  bothSigned: boolean;           // true if both signatures are present
  sessionsCreated: number;
  warnings: string[];            // skipped shoots (conflicts / bad data)
}

/**
 * Finalize the project IFF both parties have signed and it isn't finalized yet.
 * Idempotent + safe to call from either signing route.
 */
export async function finalizeIfBothSigned(
  db: SupabaseClient,
  bookingId: string,
): Promise<FinalizeResult> {
  const service = db || createServiceClient();
  const out: FinalizeResult = {
    finalized: false,
    alreadyFinalized: false,
    bothSigned: false,
    sessionsCreated: 0,
    warnings: [],
  };

  // ── Load signing state + everything finalize needs ──────────────────
  const { data: row, error } = await service
    .from('media_bookings')
    .select(
      'id, user_id, status, offering_id, manager_agreed_at, contract_agreed_at, project_details',
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !row) {
    out.warnings.push('Booking not found for finalize');
    return out;
  }
  const booking = row as {
    id: string;
    user_id: string;
    status: string;
    offering_id: string | null;
    manager_agreed_at: string | null;
    contract_agreed_at: string | null;
    project_details: Record<string, unknown> | null;
  };

  // Both signatures required.
  if (!booking.manager_agreed_at || !booking.contract_agreed_at) {
    return out;
  }
  out.bothSigned = true;

  const details = (booking.project_details || {}) as Record<string, unknown>;

  // Idempotency gate — already finalized.
  if (details.contract_finalized_at) {
    out.alreadyFinalized = true;
    return out;
  }

  // ── Materialize planned_shoots → media_session_bookings ─────────────
  const plannedRaw = Array.isArray(details.planned_shoots)
    ? (details.planned_shoots as unknown[])
    : [];
  const createdSummaries: FinalizedSessionSummary[] = [];

  for (let i = 0; i < plannedRaw.length; i++) {
    const shoot = plannedRaw[i] as PlannedShoot;
    const idxLabel = `Shoot ${i + 1}`;

    const window = shootWindow(shoot);
    if (!window) {
      out.warnings.push(`${idxLabel}: skipped — invalid date/time/duration.`);
      continue;
    }

    const location: MediaSessionLocation =
      shoot.location === 'external' ? 'external' : 'studio';
    const sessionKind: MediaSessionKind =
      shoot.session_kind && VALID_KINDS.includes(shoot.session_kind)
        ? shoot.session_kind
        : 'video';
    const externalLocationText =
      location === 'external'
        ? (shoot.external_location_text
            ? String(shoot.external_location_text).trim()
            : null)
        : null;

    // Resolve engineer by name → user_id (we never trust a client id). The
    // engineer FK is required on media_session_bookings, so skip if we can't
    // resolve one.
    const engineerName = shoot.engineer_name
      ? String(shoot.engineer_name).trim()
      : '';
    if (!engineerName) {
      out.warnings.push(`${idxLabel}: skipped — no engineer assigned.`);
      continue;
    }
    const engineerEntry = ENGINEERS.find((e) => e.name === engineerName);
    if (!engineerEntry) {
      out.warnings.push(`${idxLabel}: skipped — unknown engineer "${engineerName}".`);
      continue;
    }
    const engineerUserId = await getEngineerUserIdByName(engineerName, service);
    if (!engineerUserId) {
      out.warnings.push(
        `${idxLabel}: skipped — ${engineerName} is not onboarded yet.`,
      );
      continue;
    }

    // Studio shoots block studio time → conflict check (skip + warn, never
    // throw). External shoots are non-blocking → create directly.
    if (location === 'studio') {
      const conflict = await checkMediaSessionConflict(
        {
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          engineerId: engineerUserId,
          location,
        },
        service,
      );
      if (conflict) {
        out.warnings.push(
          `${idxLabel}: skipped — conflicts with ${conflict.label}. Reschedule it from the order page.`,
        );
        continue;
      }
    }

    const { error: insErr } = await service
      .from('media_session_bookings')
      .insert({
        parent_booking_id: bookingId,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        location,
        external_location_text: externalLocationText,
        engineer_id: engineerUserId,
        session_kind: sessionKind,
        status: 'scheduled',
      });
    if (insErr) {
      console.error('[media-contract-finalize] session insert error:', insErr);
      out.warnings.push(`${idxLabel}: skipped — could not save the session.`);
      continue;
    }

    out.sessionsCreated++;
    createdSummaries.push({
      sessionKind,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      location,
      externalLocationText,
      engineerName: engineerEntry.name,
    });
  }

  // ── Stamp finalize + advance status (idempotent race guard) ─────────
  const nowIso = new Date().toISOString();
  const nextDetails = {
    ...details,
    contract_finalized_at: nowIso,
  };
  // Only advance to 'scheduled' from a pre-schedulable state; never regress
  // a project that already moved further along (e.g. in production / delivered).
  const PRE_SCHEDULE = ['inquiry', 'deposited'];
  const nextStatus = PRE_SCHEDULE.includes(booking.status)
    ? 'scheduled'
    : booking.status;

  const { error: updErr } = await service
    .from('media_bookings')
    .update({
      project_details: nextDetails,
      status: nextStatus,
    })
    .eq('id', bookingId)
    // Race guard: only the first finalize wins. A concurrent finalize (other
    // signing route) finds contract_finalized_at already set and no-ops.
    .is('project_details->>contract_finalized_at', null);
  if (updErr) {
    console.error('[media-contract-finalize] finalize update error:', updErr);
    out.warnings.push('Could not stamp finalize.');
    return out;
  }

  out.finalized = true;

  // ── Audit ───────────────────────────────────────────────────────────
  await service.from('media_booking_audit_log').insert({
    booking_id: bookingId,
    action: 'contract_finalized',
    performed_by: 'system',
    details: {
      finalized_at: nowIso,
      sessions_created: out.sessionsCreated,
      warnings: out.warnings,
    },
  });

  // ── Confirmation emails (fire-and-forget, both parties) ─────────────
  // Resolve artist + manager emails + offering title.
  const [{ data: buyerRow }, { data: offeringRow }] = await Promise.all([
    service
      .from('profiles')
      .select('email, display_name')
      .eq('user_id', booking.user_id)
      .maybeSingle(),
    booking.offering_id
      ? service
          .from('media_offerings')
          .select('title')
          .eq('id', booking.offering_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const buyer = buyerRow as
    | { email: string | null; display_name: string | null }
    | null;
  const offeringTitle =
    (offeringRow as { title?: string } | null)?.title || 'your media project';

  // Manager email = whoever stamped manager_agreed_by, resolved to a profile;
  // fall back to nothing if not resolvable (email is best-effort).
  let managerEmail: string | null = null;
  {
    const { data: mb } = await service
      .from('media_bookings')
      .select('manager_agreed_by')
      .eq('id', bookingId)
      .maybeSingle();
    const managerId = (mb as { manager_agreed_by?: string | null } | null)
      ?.manager_agreed_by;
    if (managerId) {
      const { data: mp } = await service
        .from('profiles')
        .select('email')
        .eq('user_id', managerId)
        .maybeSingle();
      managerEmail = (mp as { email?: string | null } | null)?.email ?? null;
    }
  }

  if (buyer?.email) {
    try {
      await sendMediaContractFinalized(buyer.email, {
        recipientName: buyer.display_name || 'there',
        recipientRole: 'artist',
        offeringTitle,
        bookingId,
        sessions: createdSummaries,
        warnings: out.warnings,
      });
    } catch (e) {
      console.error('[media-contract-finalize] artist email error:', e);
    }
  }
  if (managerEmail) {
    try {
      await sendMediaContractFinalized(managerEmail, {
        recipientName: 'Team',
        recipientRole: 'manager',
        offeringTitle,
        bookingId,
        sessions: createdSummaries,
        warnings: out.warnings,
      });
    } catch (e) {
      console.error('[media-contract-finalize] manager email error:', e);
    }
  }

  return out;
}
