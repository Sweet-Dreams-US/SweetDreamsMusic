import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { ENGINEERS } from '@/lib/constants';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Get this engineer's display name
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .single();

  const engineerName = profile?.display_name || user.email || '';

  // Build list of names this engineer might be stored under
  const matchNames = new Set<string>([engineerName]);
  const engineerConfig = ENGINEERS.find(e => e.email === user.email);
  if (engineerConfig) {
    matchNames.add(engineerConfig.name);
    matchNames.add(engineerConfig.displayName);
  }

  // Fetch all bookings where this engineer is assigned
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, customer_phone, artist_name, start_time, end_time, duration, room, total_amount, deposit_amount, remainder_amount, actual_deposit_paid, status, engineer_name, created_at, admin_notes')
    .in('engineer_name', [...matchNames])
    .not('status', 'eq', 'cancelled')
    .order('start_time', { ascending: false });

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ clients: [], engineerName });
  }

  // Get distinct customer emails from these bookings
  const customerEmails = new Set<string>();
  for (const b of bookings) {
    if (b.customer_email) customerEmails.add(b.customer_email.toLowerCase());
  }

  // Fetch profiles matching those emails
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, user_id, display_name, profile_picture_url, public_profile_slug, role, email, is_producer, producer_name')
    .in('email', [...customerEmails]);

  // Get file counts per user
  const profileUserIds = (profiles || []).map(p => p.user_id);
  const { data: fileCounts } = profileUserIds.length > 0
    ? await supabase.from('deliverables').select('user_id').in('user_id', profileUserIds)
    : { data: [] };

  // Get note counts per user
  const { data: noteCounts } = profileUserIds.length > 0
    ? await supabase.from('library_notes').select('user_id').in('user_id', profileUserIds)
    : { data: [] };

  const fileCountMap: Record<string, number> = {};
  fileCounts?.forEach((f) => {
    fileCountMap[f.user_id] = (fileCountMap[f.user_id] || 0) + 1;
  });

  const noteCountMap: Record<string, number> = {};
  noteCounts?.forEach((n) => {
    noteCountMap[n.user_id] = (noteCountMap[n.user_id] || 0) + 1;
  });

  // Aggregate booking data per customer email (only THIS engineer's sessions)
  const bookingAggregates: Record<string, {
    session_count: number;
    total_revenue: number;
    last_session: string | null;
    phone: string | null;
  }> = {};

  for (const b of bookings) {
    const email = b.customer_email?.toLowerCase();
    if (!email) continue;

    if (!bookingAggregates[email]) {
      bookingAggregates[email] = {
        session_count: 0,
        total_revenue: 0,
        last_session: null,
        phone: null,
      };
    }

    const agg = bookingAggregates[email];
    agg.session_count += 1;

    if (['confirmed', 'completed', 'approved'].includes(b.status)) {
      agg.total_revenue += b.total_amount || 0;
    }

    if (b.start_time && (!agg.last_session || b.start_time > agg.last_session)) {
      agg.last_session = b.start_time;
    }

    if (b.customer_phone) agg.phone = b.customer_phone;
  }

  // Build client list from profiles
  const profileMap = new Map((profiles || []).map(p => [p.email?.toLowerCase(), p]));

  const clients = [...customerEmails].map(email => {
    const p = profileMap.get(email);
    const agg = bookingAggregates[email];

    return {
      id: p?.id || email,
      user_id: p?.user_id || null,
      display_name: p?.display_name || agg?.phone || email,
      profile_picture_url: p?.profile_picture_url || null,
      public_profile_slug: p?.public_profile_slug || null,
      email,
      is_producer: p?.is_producer || false,
      producer_name: p?.producer_name || null,
      files_count: p ? (fileCountMap[p.user_id] || 0) : 0,
      notes_count: p ? (noteCountMap[p.user_id] || 0) : 0,
      session_count: agg?.session_count || 0,
      total_revenue: agg?.total_revenue || 0,
      last_session: agg?.last_session || null,
      phone: agg?.phone || null,
    };
  }).filter(c => c.session_count > 0);

  return NextResponse.json({ clients, engineerName });
}
