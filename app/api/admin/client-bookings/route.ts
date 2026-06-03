import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
  }

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, customer_phone, artist_name, start_time, end_time, duration, room, total_amount, deposit_amount, remainder_amount, actual_deposit_paid, stripe_payment_intent_id, status, engineer_name, created_at, admin_notes')
    .eq('customer_email', email)
    .order('start_time', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ bookings: bookings || [] });
}
