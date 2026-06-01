import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Look up a booking by ID and validate the invite token
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get('booking');
  const token = searchParams.get('token');

  if (!bookingId || !token) {
    return NextResponse.json({ error: 'Missing booking or token' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, artist_name, start_time, duration, room, total_amount, deposit_amount, remainder_amount, status, engineer_name, admin_notes, media_addons, deposit_method')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Validate token is in admin_notes
  if (!booking.admin_notes || !booking.admin_notes.includes(`Token: ${token}`)) {
    return NextResponse.json({ error: 'Invalid invite token' }, { status: 403 });
  }

  // Don't expose admin_notes to client
  const { admin_notes, ...safeBooking } = booking;

  return NextResponse.json({ booking: safeBooking });
}
