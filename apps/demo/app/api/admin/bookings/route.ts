import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const engineer = searchParams.get('engineer');
  const limit = parseInt(searchParams.get('limit') || '50');

  // Embed the band's display_name via the band_id FK. Keyed as `band` so the
  // admin UI can render `booking.band?.display_name` without an extra round-trip.
  // `band_id` is the only FK between bookings → bands, so Supabase auto-resolves.
  let query = supabase
    .from('bookings')
    .select('*, band:bands(display_name)')
    .order('start_time', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  if (engineer) {
    query = query.eq('engineer_name', engineer);
  }

  const { data: bookings, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ bookings });
}
