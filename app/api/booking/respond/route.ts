import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import {
  sendEngineerAssigned,
  sendEngineerClaimConfirmation,
  sendEngineerPassNotification,
  sendPriorityExpiredToClient,
  sendBandSessionNeedsRescheduleAdmin,
} from '@/lib/email';
import { ENGINEERS, findEngineerByEmail, isSameEngineer, type Room } from '@/lib/constants';
import { fmtSessionDate, fmtSessionTime, fmtStampDateTime } from '@/lib/studio-time';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { bookingId, action } = await request.json();
  if (!bookingId || !action) {
    return NextResponse.json({ error: 'bookingId and action required' }, { status: 400 });
  }

  if (!['accept', 'pass'].includes(action)) {
    return NextResponse.json({ error: 'action must be "accept" or "pass"' }, { status: 400 });
  }

  // Get engineer profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .single();

  // Resolve identity by EMAIL (stable, owned by us) — not by display_name
  // (user-editable, drifts). When the engineer is in the roster, write
  // their canonical roster `name` so accounting + payouts roll up against
  // the same string used historically. Falls back to profile.display_name
  // for engineers outside the roster.
  const engineerConfig = findEngineerByEmail(user.email);
  const engineerName =
    engineerConfig?.name || profile?.display_name || user.email || 'Engineer';

  // Get the booking
  const serviceClient = createServiceClient();
  const { data: booking } = await serviceClient
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.engineer_name) {
    return NextResponse.json({ error: 'Session already claimed' }, { status: 409 });
  }

  // Check this engineer is the requested one (for priority window actions).
  // Goes through isSameEngineer so name drift in profile.display_name can't
  // reject the legitimate requested engineer (e.g. Zion's profile drifted
  // from "Zion" to "Zion Omari" — both are the same human).
  const isRequestedEngineer = isSameEngineer(
    user.email,
    profile?.display_name,
    booking.requested_engineer,
  );

  // Format dates for emails — bookings.start_time is wall-clock-as-UTC → fmtSession*
  const dateStr = fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = fmtSessionTime(booking.start_time);

  // ---- ACCEPT ----
  if (action === 'accept') {
    // During priority window, only the requested engineer can accept
    if (booking.requested_engineer && booking.priority_expires_at) {
      const isInPriorityWindow = new Date(booking.priority_expires_at) > new Date();
      if (isInPriorityWindow && !isRequestedEngineer) {
        return NextResponse.json(
          { error: `This session was requested for ${booking.requested_engineer}. They have priority until their window expires.` },
          { status: 403 }
        );
      }
    }

    // Verify studio access
    if (engineerConfig && booking.room && !engineerConfig.studios.includes(booking.room as Room)) {
      const studioLabel = booking.room === 'studio_a' ? 'Studio A' : 'Studio B';
      return NextResponse.json({ error: `You are not assigned to ${studioLabel}` }, { status: 403 });
    }

    // Claim the session (atomic — only if still unclaimed)
    const { data: updated, error } = await serviceClient
      .from('bookings')
      .update({
        engineer_name: engineerName,
        claimed_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .is('engineer_name', null)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: 'Session already claimed by another engineer' }, { status: 409 });
    }

    // Determine if this engineer is NOT who the client requested
    const isNonRequestedClaim = booking.requested_engineer &&
      !isRequestedEngineer &&
      booking.customer_email;

    if (isNonRequestedClaim) {
      // Import and send the non-requested engineer email
      const { sendEngineerAssignedNonRequested } = await import('@/lib/email');
      // bookings.reschedule_deadline is a true-UTC *_at instant → convert to Eastern (fmtStamp*)
      const rescheduleDeadlineStr = booking.reschedule_deadline
        ? fmtStampDateTime(booking.reschedule_deadline, {
            weekday: 'short', month: 'short', day: 'numeric',
          })
        : '8 hours before your session';

      await sendEngineerAssignedNonRequested(booking.customer_email, {
        customerName: booking.customer_name,
        requestedEngineer: booking.requested_engineer,
        assignedEngineer: engineerName,
        date: dateStr,
        startTime: timeStr,
        rescheduleDeadline: rescheduleDeadlineStr,
      });
    } else if (booking.customer_email) {
      // Standard: send "your engineer is confirmed" email
      await sendEngineerAssigned(booking.customer_email, {
        customerName: booking.customer_name,
        engineerName,
        date: dateStr,
        startTime: timeStr,
      });
    }

    // Send confirmation to the engineer
    const engineerEmail = engineerConfig?.email || user.email;
    if (engineerEmail) {
      await sendEngineerClaimConfirmation(engineerEmail, {
        engineerName,
        customerName: booking.customer_name,
        date: dateStr,
        startTime: timeStr,
        duration: booking.duration,
        room: booking.room || '',
        total: booking.total_amount,
        remainder: booking.remainder_amount || 0,
      });
    }

    return NextResponse.json({ success: true, action: 'accepted', booking: updated });
  }

  // ---- PASS ----
  if (action === 'pass') {
    if (!isRequestedEngineer) {
      return NextResponse.json({ error: 'Only the requested engineer can pass' }, { status: 403 });
    }

    // Mark as passed. For solo sessions this immediately opens to all
    // other engineers in the studio. Bands are different — only Iszac is
    // qualified to run a band session, so a pass means admins need to
    // coordinate a reschedule with the band directly. No other engineer
    // is ever notified for a band pass.
    const { error: passErr } = await serviceClient.from('bookings').update({
      engineer_passed: true,
      engineer_passed_at: new Date().toISOString(),
      priority_expires_at: new Date().toISOString(), // Expire priority immediately
      priority_notified: true, // Prevent the cron from re-processing
    }).eq('id', bookingId);
    if (passErr) {
      // If the pass write fails the booking is still claimable — don't fire
      // notifications that imply otherwise.
      console.error('[respond] pass update failed:', passErr);
      return NextResponse.json({ error: 'Could not record pass' }, { status: 500 });
    }

    const isBandBooking = !!booking.band_id;

    if (isBandBooking) {
      // Band branch: alert admins, no buyer email yet (Round 8b chat thread
      // will be the proper surface), no fan-out to other engineers.
      let bandName: string | null = null;
      try {
        const { data: bandRow } = await serviceClient
          .from('bands')
          .select('display_name')
          .eq('id', booking.band_id)
          .maybeSingle();
        bandName = (bandRow as { display_name: string } | null)?.display_name ?? null;
      } catch { /* best-effort lookup */ }

      await sendBandSessionNeedsRescheduleAdmin({
        bookingId,
        customerName: booking.customer_name,
        bandName,
        date: dateStr,
        startTime: timeStr,
        duration: booking.duration,
      });

      return NextResponse.json({ success: true, action: 'passed', band: true });
    }

    // Solo branch — existing behavior unchanged.
    // Notify the client
    if (booking.customer_email && booking.requested_engineer) {
      await sendPriorityExpiredToClient(booking.customer_email, {
        customerName: booking.customer_name,
        requestedEngineer: booking.requested_engineer,
        date: dateStr,
        startTime: timeStr,
      });
    }

    // Notify all other engineers for this studio
    const room = booking.room as string;
    const otherEngineers = ENGINEERS
      .filter((e) => e.studios.includes(room as Room))
      .filter((e) => e.name !== booking.requested_engineer && e.displayName !== booking.requested_engineer)
      .map((e) => e.email);

    if (otherEngineers.length > 0) {
      await sendEngineerPassNotification(otherEngineers, {
        customerName: booking.customer_name,
        date: dateStr,
        startTime: timeStr,
        duration: booking.duration,
        room: booking.room || '',
        passedEngineer: booking.requested_engineer || engineerName,
      });
    }

    return NextResponse.json({ success: true, action: 'passed' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
