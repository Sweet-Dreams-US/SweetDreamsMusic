import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { sendEngineerAssigned, sendEngineerAssignedNonRequested, sendEngineerClaimConfirmation } from '@/lib/email';
import { findEngineerByEmail, isSameEngineer, type Room } from '@/lib/constants';
import { fmtSessionDate, fmtSessionTime, fmtStampDateTime } from '@/lib/studio-time';

// Legacy claim endpoint — now wraps the same logic as /respond accept
// Kept for backward compatibility
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { bookingId } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  // Get user's display name from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .single();

  // Resolve roster entry by email (stable). When found, write the
  // canonical roster name so accounting/payouts match the historical
  // string. See lib/constants.ts → findEngineerByEmail for rationale.
  const engineerConfig = findEngineerByEmail(user.email);
  const engineerName =
    engineerConfig?.name || profile?.display_name || user.email || 'Engineer';

  // Check the booking
  const { data: booking } = await supabase
    .from('bookings')
    .select('room, requested_engineer, priority_expires_at, customer_name, customer_email, reschedule_deadline')
    .eq('id', bookingId)
    .single();

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Check priority window
  if (booking.requested_engineer && booking.priority_expires_at) {
    const priorityExpiry = new Date(booking.priority_expires_at);
    const isInPriorityWindow = priorityExpiry > new Date();

    if (isInPriorityWindow) {
      const isRequestedEngineer = isSameEngineer(
        user.email,
        profile?.display_name,
        booking.requested_engineer,
      );

      if (!isRequestedEngineer) {
        // priority_expires_at is a true-UTC *_at instant → convert to Eastern (fmtStamp*)
        const expiryStr = fmtStampDateTime(priorityExpiry.toISOString(), {
          weekday: 'short', month: 'short', day: 'numeric',
        });
        return NextResponse.json(
          { error: `This session was requested for ${booking.requested_engineer}. They have priority until ${expiryStr}.` },
          { status: 403 }
        );
      }
    }
  }

  // Verify studio access
  if (engineerConfig && booking.room && !engineerConfig.studios.includes(booking.room as Room)) {
    const studioLabel = booking.room === 'studio_a' ? 'Studio A' : 'Studio B';
    return NextResponse.json(
      { error: `You are not assigned to ${studioLabel}` },
      { status: 403 }
    );
  }

  // Claim the session — only succeeds if engineer_name is still null
  const { data: updated, error } = await supabase
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

  // bookings.start_time is wall-clock-as-UTC → read as UTC (fmtSession*)
  const dateStr = fmtSessionDate(updated.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = fmtSessionTime(updated.start_time);

  // Determine if this is a non-requested engineer claiming.
  // Same email-first resolution as the priority-window check above.
  const isRequestedEngineer = isSameEngineer(
    user.email,
    profile?.display_name,
    booking.requested_engineer,
  );

  const isNonRequestedClaim = booking.requested_engineer && !isRequestedEngineer;

  if (isNonRequestedClaim && updated.customer_email) {
    // bookings.reschedule_deadline is a true-UTC *_at instant → convert to Eastern (fmtStamp*)
    const rescheduleDeadlineStr = booking.reschedule_deadline
      ? fmtStampDateTime(booking.reschedule_deadline, {
          weekday: 'short', month: 'short', day: 'numeric',
        })
      : '8 hours before your session';

    await sendEngineerAssignedNonRequested(updated.customer_email, {
      customerName: updated.customer_name,
      requestedEngineer: booking.requested_engineer!,
      assignedEngineer: engineerName,
      date: dateStr,
      startTime: timeStr,
      rescheduleDeadline: rescheduleDeadlineStr,
    });
  } else if (updated.customer_email) {
    await sendEngineerAssigned(updated.customer_email, {
      customerName: updated.customer_name,
      engineerName,
      date: dateStr,
      startTime: timeStr,
    });
  }

  // Send confirmation to the engineer who claimed it
  const engineerEmail = engineerConfig?.email || user.email;
  if (engineerEmail) {
    await sendEngineerClaimConfirmation(engineerEmail, {
      engineerName,
      customerName: updated.customer_name,
      date: dateStr,
      startTime: timeStr,
      duration: updated.duration,
      room: updated.room || '',
      total: updated.total_amount,
      remainder: updated.remainder_amount || 0,
    });
  }

  return NextResponse.json({ success: true, booking: updated });
}
