import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEngineerNewBookingAlert, sendPriorityExpiredToClient, sendPriorityReminderToEngineer } from '@/lib/email';
import { ENGINEERS, SUPER_ADMINS, type Room } from '@/lib/constants';
import { getPriorityHoursLabel } from '@/lib/priority';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const nowStr = now.toISOString();

  let processed = 0;
  let reminders = 0;

  // ==============================
  // 1. Send reminder nudges (2 hours before priority expires)
  // ==============================
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const { data: reminderBookings } = await supabase
    .from('bookings')
    .select('*')
    .gt('priority_expires_at', nowStr)          // Priority hasn't expired yet
    .lt('priority_expires_at', twoHoursFromNow) // But will expire within 2 hours
    .eq('priority_reminder_sent', false)
    .is('engineer_name', null)
    .eq('engineer_passed', false)
    .in('status', ['confirmed', 'pending']);

  for (const booking of reminderBookings || []) {
    const requestedEng = ENGINEERS.find(
      (e) => e.name === booking.requested_engineer || e.displayName === booking.requested_engineer
    );

    if (requestedEng) {
      // bookings.start_time is wall-clock-as-UTC → read as UTC (fmtSession*)
      const dateStr = fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
      const timeStr = fmtSessionTime(booking.start_time);
      const hoursRemaining = getPriorityHoursLabel(booking.priority_expires_at);

      await sendPriorityReminderToEngineer(requestedEng.email, {
        customerName: booking.customer_name,
        date: dateStr,
        startTime: timeStr,
        room: booking.room || '',
        hoursRemaining,
      });

      await supabase.from('bookings').update({
        priority_reminder_sent: true,
      }).eq('id', booking.id);

      reminders++;
    }
  }

  // ==============================
  // 2. Handle expired priority windows
  // ==============================
  const { data: expiredBookings } = await supabase
    .from('bookings')
    .select('*')
    .lt('priority_expires_at', nowStr)
    .eq('priority_notified', false)
    .is('engineer_name', null)
    .in('status', ['confirmed', 'pending']);

  for (const booking of expiredBookings || []) {
    // bookings.start_time is wall-clock-as-UTC → read as UTC (fmtSession*)
    const dateStr = fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
    const timeStr = fmtSessionTime(booking.start_time);

    // 1. Notify client that preferred engineer is unavailable
    if (booking.customer_email && booking.requested_engineer) {
      await sendPriorityExpiredToClient(booking.customer_email, {
        customerName: booking.customer_name,
        requestedEngineer: booking.requested_engineer,
        date: dateStr,
        startTime: timeStr,
      });
    }

    // 2. Open to all engineers — send alert to everyone for this studio
    const room = booking.room as string;
    const engineerEmails = ENGINEERS
      .filter((e) => e.studios.includes(room as Room))
      .filter((e) => e.name !== booking.requested_engineer && e.displayName !== booking.requested_engineer)
      .map((e) => e.email);

    if (engineerEmails.length > 0) {
      await sendEngineerNewBookingAlert(engineerEmails, {
        id: booking.id,
        customerName: booking.customer_name,
        date: dateStr,
        startTime: timeStr,
        duration: booking.duration,
        room: booking.room || '',
      });
    }

    // 3. Mark as notified
    await supabase.from('bookings').update({
      priority_notified: true,
    }).eq('id', booking.id);

    processed++;
  }

  // ==============================
  // 3. Safety net: urgent alert for unclaimed sessions within 12 hours
  // ==============================
  const twelveHoursFromNow = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

  const { data: urgentBookings } = await supabase
    .from('bookings')
    .select('id, customer_name, start_time, room, duration')
    .is('engineer_name', null)
    .lt('start_time', twelveHoursFromNow)
    .gt('start_time', nowStr)
    .in('status', ['confirmed', 'pending']);

  // If there are unclaimed sessions within 12 hours, alert admins
  if (urgentBookings && urgentBookings.length > 0) {
    // Only alert once — check if priority_notified is already true (meaning we already opened it up)
    // This is just a safety log for now; could send an admin email
    for (const ub of urgentBookings) {
      console.warn(`[URGENT] Unclaimed session in <12hrs: ${ub.customer_name} at ${ub.start_time}`);
    }
  }

  return NextResponse.json({ processed, reminders, urgent: urgentBookings?.length || 0 });
}
