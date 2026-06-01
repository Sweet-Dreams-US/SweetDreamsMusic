import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { SITE_URL, ENGINEERS, ROOM_LABELS, type Room } from '@/lib/constants';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { sendSessionInvite } from '@/lib/email';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Engineers and admins only' }, { status: 403 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { bookingId } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  const serviceClient = createServiceClient();

  const { data: booking, error } = await serviceClient
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (!booking.customer_email) {
    return NextResponse.json({ error: 'No email on file for this client' }, { status: 400 });
  }

  // Extract invite token from admin_notes
  const tokenMatch = booking.admin_notes?.match(/Token: ([a-f0-9-]+)/);
  if (!tokenMatch) {
    return NextResponse.json({ error: 'No invite token found for this booking' }, { status: 400 });
  }

  const inviteToken = tokenMatch[1];
  const inviteUrl = `${SITE_URL}/book/invite/${inviteToken}?booking=${booking.id}`;
  // Cash is determined by deposit_method (migration 063), not the old
  // deposit_amount===0 heuristic — new cash invites carry a real 50% deposit
  // and sit in pending_deposit until the engineer records the cash.
  const isCash = booking.deposit_method === 'cash';

  const engineerConfig = ENGINEERS.find(e => e.email.toLowerCase() === user.email!.toLowerCase());
  const engineerName = engineerConfig?.displayName || booking.engineer_name || 'Your engineer';

  const startDate = new Date(booking.start_time);
  const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

  try {
    await sendSessionInvite(booking.customer_email, {
      customerName: booking.customer_name || 'Client',
      engineerName,
      date: dateStr,
      startTime: timeStr,
      duration: booking.duration,
      room: booking.room || '',
      total: booking.total_amount,
      deposit: booking.deposit_amount,
      inviteUrl,
      isCash,
    });

    return NextResponse.json({ success: true, to: booking.customer_email });
  } catch (emailErr) {
    console.error('Failed to resend invite:', emailErr);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
