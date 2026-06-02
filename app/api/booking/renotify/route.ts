import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { sendBookingConfirmation, sendEngineerNewBookingAlert } from '@/lib/email';
import { ENGINEERS, ROOM_LABELS, type Room } from '@/lib/constants';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId, type } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // bookings.start_time is wall-clock-as-UTC → read as UTC (fmtSession*)
  const dateStr = fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = fmtSessionTime(booking.start_time);

  if (type === 'engineer_alert') {
    // Resend new booking alert to engineers for this studio
    const room = booking.room as string;
    const engineerEmails = ENGINEERS
      .filter((e) => e.studios.includes(room as Room))
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

    return NextResponse.json({ success: true, sent: 'engineer_alert', to: engineerEmails });
  }

  // Default: resend customer confirmation
  if (booking.customer_email) {
    await sendBookingConfirmation(booking.customer_email, {
      customerName: booking.customer_name,
      date: dateStr,
      startTime: timeStr,
      duration: booking.duration,
      room: booking.room || '',
      total: booking.total_amount,
      deposit: booking.actual_deposit_paid || booking.deposit_amount,
    });
  }

  return NextResponse.json({ success: true, sent: 'confirmation', to: booking.customer_email });
}
