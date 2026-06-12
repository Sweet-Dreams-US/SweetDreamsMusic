import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendRescheduleRequestAlert } from '@/lib/email';
import { canRequestReschedule } from '@/lib/priority';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { bookingId, reason } = await request.json();
  if (!bookingId || !reason) {
    return NextResponse.json({ error: 'bookingId and reason required' }, { status: 400 });
  }

  // Get the booking — verify ownership via email
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('user_id', user.id)
    .single();

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Verify this user owns the booking
  if (booking.customer_email !== user.email && booking.customer_email !== profile?.email) {
    return NextResponse.json({ error: 'Not authorized for this booking' }, { status: 403 });
  }

  // Check booking is still in a state that can be rescheduled
  if (!['confirmed', 'pending', 'approved'].includes(booking.status)) {
    return NextResponse.json({ error: 'This booking cannot be rescheduled' }, { status: 400 });
  }

  // Check 8-hour reschedule deadline
  if (!canRequestReschedule(booking.start_time)) {
    return NextResponse.json({
      error: 'Reschedule requests must be submitted at least 8 hours before the session. Please contact us directly.',
    }, { status: 400 });
  }

  // Check if already requested
  if (booking.reschedule_requested) {
    return NextResponse.json({ error: 'Reschedule already requested for this booking' }, { status: 400 });
  }

  // Mark the reschedule request
  await supabase.from('bookings').update({
    reschedule_requested: true,
    reschedule_reason: reason,
    reschedule_requested_at: new Date().toISOString(),
  }).eq('id', bookingId);

  // Notify admins — bookings.start_time is wall-clock-as-UTC → fmtSession*
  const dateStr = fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = fmtSessionTime(booking.start_time);

  await sendRescheduleRequestAlert({
    customerName: booking.customer_name,
    customerEmail: booking.customer_email || user.email || '',
    artistName: booking.artist_name,
    date: dateStr,
    startTime: timeStr,
    room: booking.room || '',
    reason,
    currentEngineer: booking.engineer_name,
  });

  return NextResponse.json({ success: true, message: 'Reschedule request submitted. Our team will reach out to coordinate.' });
}
