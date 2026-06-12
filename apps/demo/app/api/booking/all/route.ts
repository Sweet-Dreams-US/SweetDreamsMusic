import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

// All confirmed/upcoming bookings — for engineers to see studio availability
export async function GET() {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  // Show bookings from today onward (include today's sessions that might still be in progress)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, customer_name, artist_name, start_time, end_time, duration, room, engineer_name, status, deposit_method')
    .in('status', ['confirmed', 'pending', 'pending_deposit'])
    .gte('start_time', todayStart)
    .order('start_time', { ascending: true })
    .limit(50);

  return NextResponse.json({ bookings: bookings || [] });
}
