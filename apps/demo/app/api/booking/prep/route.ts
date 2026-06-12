import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET — fetch session prep for a booking
export async function GET(request: NextRequest) {
  try {
    const bookingId = request.nextUrl.searchParams.get('bookingId');
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Verify booking ownership or staff access
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const isStaff = profile?.role === 'engineer' || profile?.role === 'admin';

    if (!isStaff) {
      // Non-staff: verify they own the booking
      const { createServiceClient } = await import('@/lib/supabase/server');
      const serviceClient = createServiceClient();
      const { data: booking } = await serviceClient
        .from('bookings')
        .select('customer_email')
        .eq('id', bookingId)
        .single();

      if (!booking || booking.customer_email !== user.email) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }
    }

    const { data: prep } = await supabase
      .from('session_prep')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();

    return NextResponse.json({ prep });
  } catch (error) {
    console.error('Session prep GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST — create or update session prep
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { bookingId, ...prepData } = body;

    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }

    // Verify this booking belongs to the user
    const serviceClient = createServiceClient();
    const { data: booking } = await serviceClient
      .from('bookings')
      .select('id, customer_email, status')
      .eq('id', bookingId)
      .single();

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (booking.customer_email !== user.email) {
      // Check if user is engineer/admin (they can also view)
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (!profile || !['engineer', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }
    }

    // Check if prep already exists
    const { data: existing } = await supabase
      .from('session_prep')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle();

    const now = new Date().toISOString();
    const isCompleted = prepData.completed;

    if (existing) {
      // Update
      const { data: updated, error } = await supabase
        .from('session_prep')
        .update({
          ...prepData,
          updated_at: now,
          completed_at: isCompleted ? now : null,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('Session prep update error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ prep: updated });
    } else {
      // Create
      const { data: created, error } = await supabase
        .from('session_prep')
        .insert({
          booking_id: bookingId,
          user_id: user.id,
          ...prepData,
          ...(isCompleted ? { completed_at: now } : {}),
        })
        .select()
        .single();

      if (error) {
        console.error('Session prep create error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ prep: created });
    }
  } catch (error) {
    console.error('Session prep POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
