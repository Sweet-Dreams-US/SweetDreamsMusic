import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { ENGINEERS, SUPER_ADMINS, type Room } from '@/lib/constants';
import { sendCashChosenAlert } from '@/lib/email';

// Client elects to pay their invite deposit in CASH. This does NOT charge or
// hold the slot — it records the intent (deposit_method='cash'), keeps the
// booking 'pending_deposit', and alerts the engineer to collect + record cash.
export async function POST(request: NextRequest) {
  try {
    const { bookingId, token } = await request.json();
    if (!bookingId || !token) {
      return NextResponse.json({ error: 'Missing bookingId or token' }, { status: 400 });
    }

    // Require an authenticated account (same gate as the card path)
    const authClient = await createClient();
    const { data: { user: authUser } } = await authClient.auth.getUser();
    if (!authUser) {
      return NextResponse.json({ error: 'You must be signed in to confirm your session.' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Validate token (matches invite/pay)
    if (!booking.admin_notes || !booking.admin_notes.includes(`Token: ${token}`)) {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 403 });
    }

    if (booking.status === 'confirmed') {
      return NextResponse.json({ alreadyConfirmed: true, message: 'Session already confirmed' });
    }
    if (booking.status !== 'pending' && booking.status !== 'pending_deposit') {
      return NextResponse.json({ error: 'This booking has been cancelled. Please contact the studio for a new invite.' }, { status: 400 });
    }

    // Idempotent: if cash was already chosen, don't re-process or re-email the
    // engineer (guards against a double-tap firing two alerts).
    if (booking.deposit_method === 'cash') {
      return NextResponse.json({ success: true });
    }

    // Link the booking to the authenticated account (mirrors invite/pay)
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', authUser.id)
      .single();
    const realName = profile?.display_name || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Client';
    const realEmail = authUser.email || booking.customer_email;

    const { error: updateErr } = await supabase
      .from('bookings')
      .update({
        customer_name: realName,
        customer_email: realEmail,
        deposit_method: 'cash',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateErr) {
      console.error('choose-cash update failed:', updateErr);
      return NextResponse.json({ error: 'Could not update booking' }, { status: 500 });
    }

    // Alert the engineer (fall back to super admins if unassigned)
    const engineerCfg = ENGINEERS.find(
      (e) => e.name === booking.engineer_name || e.displayName === booking.engineer_name,
    );
    const alertTo = engineerCfg?.email || SUPER_ADMINS[0];
    const startDate = new Date(booking.start_time);
    const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

    await sendCashChosenAlert(alertTo, {
      customerName: realName,
      artistName: booking.artist_name,
      date: dateStr,
      startTime: timeStr,
      room: (booking.room as Room) || '',
      depositAmount: booking.deposit_amount || 0,
      engineerName: booking.engineer_name,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('choose-cash error:', err);
    return NextResponse.json({ error: 'Failed to choose cash' }, { status: 500 });
  }
}
