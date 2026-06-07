import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess, isAdmin } from '@/lib/admin-auth';
import { checkCanComplete } from '@/lib/booking-completion';
import { checkBookingOwnership } from '@/lib/booking-ownership';
import { getRevenueConfig, getRevenueOverrides } from '@/lib/revenue-config-server';
import { normalizeName } from '@/lib/earnings-core';

/**
 * POST /api/booking/complete
 *
 * Marks a booking's status = 'completed' IF the completion gates pass.
 *
 * Body: { bookingId: string, force?: boolean }
 *
 * Rules:
 *   - Caller must be an engineer or admin.
 *   - Engineers (non-admin) may only complete sessions they own
 *     (engineer_name matches).
 *   - The completion gates are enforced server-side — the client can't
 *     bypass them by calling the generic /api/admin/bookings/update.
 *   - `force: true` is only honored for super-admins. It skips the time
 *     and files gates, but still refuses to complete `cancelled` or
 *     already-`completed` bookings. Every force is logged verbosely.
 *
 * Returns:
 *   - 200 { success: true, forced?: boolean }
 *   - 400 { error, canCompleteCheck } if gate fails and !force
 *   - 401 / 403 for auth / ownership failures
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { bookingId?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : null;
  const force = body.force === true;
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  const isCallerAdmin = isAdmin(user.email);
  if (force && !isCallerAdmin) {
    return NextResponse.json(
      { error: 'Only super-admins may force-complete a session.' },
      { status: 403 }
    );
  }

  const service = createServiceClient();
  const check = await checkCanComplete(supabase, service, bookingId);

  if (!check.booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Ownership gate for non-admin engineers.
  const ownership = await checkBookingOwnership(supabase, check.booking.engineer_name);
  if (!ownership.isAdmin && !ownership.ownsBooking) {
    return NextResponse.json(
      { error: 'You can only complete sessions you are assigned to.' },
      { status: 403 }
    );
  }

  // Terminal-state checks can never be forced.
  if (check.booking.status === 'completed') {
    return NextResponse.json(
      {
        error: 'This session is already marked completed.',
        canCompleteCheck: check,
      },
      { status: 400 }
    );
  }
  if (check.booking.status === 'cancelled') {
    return NextResponse.json(
      {
        error: 'This session is cancelled and cannot be marked completed.',
        canCompleteCheck: check,
      },
      { status: 400 }
    );
  }

  // If gates failed and we aren't forcing, refuse.
  if (!check.canComplete && !force) {
    return NextResponse.json(
      {
        error: 'Completion gates not met.',
        canCompleteCheck: check,
      },
      { status: 400 }
    );
  }

  // If forcing while gates failed, log loudly. This is the single place
  // that creates a paper trail for "super-admin bypassed the completion
  // gate" — tied to the Bloodika-style incident we just debugged.
  const forcedBypass = force && !check.canComplete;

  const nowIso = new Date().toISOString();

  // Snapshot the EFFECTIVE engineer split % at completion so a future share
  // change can't retroactively alter this session's payout (override ?? studio
  // default ?? constant). Best-effort: on any failure leave it NULL, which the
  // payroll math reads as the constant default — safe.
  let engineerSplitPct: number | null = null;
  try {
    const [cfg, overrides] = await Promise.all([getRevenueConfig(service), getRevenueOverrides(service)]);
    const eng = normalizeName(check.booking.engineer_name);
    const isBand = check.booking.band_id != null;
    // Band sessions pay the band split (per-engineer band override ?? studio band
    // default, 70%); solo sessions pay the solo split (override ?? studio default,
    // 60%). Snapshotted here as a percent (0..100) so historical rows stay frozen.
    let basePct: number;
    if (isBand) {
      const bandOverride = eng ? overrides.engineerBandByName?.[eng] : null;
      basePct = bandOverride != null ? bandOverride : cfg.engineerBandSessionSplit * 100;
    } else {
      const overridePct = eng ? overrides.engineerByName?.[eng] : null;
      basePct = overridePct != null ? overridePct : cfg.engineerSessionSplit * 100;
    }
    engineerSplitPct = Math.round(basePct * 100) / 100;
  } catch (e) {
    console.error('[BOOKING COMPLETE] revenue snapshot failed (non-fatal):', e);
  }

  const { error: updateErr } = await supabase
    .from('bookings')
    .update({ status: 'completed', approved_at: nowIso, updated_at: nowIso, ...(engineerSplitPct != null ? { engineer_split_pct: engineerSplitPct } : {}) })
    .eq('id', bookingId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Audit — do not swallow errors silently. If logging fails, shout to stderr.
  try {
    const { error: auditErr } = await supabase.from('booking_audit_log').insert({
      booking_id: bookingId,
      action: forcedBypass ? 'forced_completion' : 'completion',
      performed_by: user.email || 'unknown',
      details: {
        forced: forcedBypass,
        reasonsAtBypass: forcedBypass ? check.reasons : [],
        gatesAtBypass: forcedBypass ? check.details : undefined,
        asAdmin: ownership.isAdmin,
        matchedNames: ownership.matchedNames,
      },
    });
    if (auditErr) {
      console.error('[BOOKING-COMPLETE] Audit log insert failed:', {
        bookingId, forced: forcedBypass, err: auditErr.message,
      });
    }
  } catch (e) {
    console.error('[BOOKING-COMPLETE] Audit log threw:', {
      bookingId, err: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({
    success: true,
    forced: forcedBypass,
  });
}
