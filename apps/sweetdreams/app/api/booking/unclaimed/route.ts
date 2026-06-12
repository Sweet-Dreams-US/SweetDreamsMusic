import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

export async function GET() {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: bookings, error } = await supabase
    .from('bookings')
    // Round 4: pull band-booking surface fields so unclaimed sessions
    // show the same 3-day group + Sweet Spot badges as the claimed list.
    .select('id, customer_name, customer_email, artist_name, start_time, end_time, duration, room, total_amount, deposit_amount, remainder_amount, actual_deposit_paid, status, created_at, admin_notes, requested_engineer, priority_expires_at, engineer_passed, reschedule_deadline, booking_group_id, sweet_spot_addon, setup_minutes_before, band_id')
    .is('engineer_name', null)
    .in('status', ['confirmed', 'pending'])
    .order('start_time', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bookings: bookings || [] });
}
