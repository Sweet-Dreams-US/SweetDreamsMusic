import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET — fetch a single booking's details for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing booking id' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check user role — engineers/admins can see any booking
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isStaff = profile?.role === 'engineer' || profile?.role === 'admin';

    let query = supabase
      .from('bookings')
      .select('id, start_time, end_time, duration, room, engineer_name, total_amount, deposit_amount, remainder_amount, status, customer_name, customer_email, artist_name, notes:admin_notes')
      .eq('id', id);

    // Non-staff can only see their own bookings
    if (!isStaff) {
      if (!user.email) {
        return NextResponse.json({ error: 'No email on account' }, { status: 400 });
      }
      query = query.eq('customer_email', user.email);
    }

    const { data: booking, error } = await query.single();

    if (error || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    return NextResponse.json({ booking });
  } catch (error) {
    console.error('Booking details error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
