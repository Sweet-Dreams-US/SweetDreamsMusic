import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { depositCollectedCents } from '@/lib/deposit';

// Fort Wayne timezone boundaries
function getFortWayneBoundaries() {
  const tz = 'America/Indiana/Indianapolis';
  const now = new Date();

  // Get "today" in Fort Wayne
  const fwNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const todayStart = new Date(fwNow.getFullYear(), fwNow.getMonth(), fwNow.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Week start (Sunday)
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  // Month start
  const monthStart = new Date(fwNow.getFullYear(), fwNow.getMonth(), 1);

  // 7 days from now
  const weekFromNow = new Date(todayStart);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  // Convert local Fort Wayne times back to ISO for Supabase queries
  const toISO = (d: Date) => {
    // Build an ISO string from the Fort Wayne local date
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return {
    todayStart: toISO(todayStart),
    todayEnd: toISO(todayEnd),
    weekStart: toISO(weekStart),
    monthStart: toISO(monthStart),
    weekFromNow: toISO(weekFromNow),
    nowISO: toISO(fwNow),
  };
}

export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const serviceClient = createServiceClient();
  const { todayStart, todayEnd, weekStart, monthStart, weekFromNow, nowISO } = getFortWayneBoundaries();

  // Run all queries in parallel
  const [
    todayBookingsRes,
    weekBookingsRes,
    monthBookingsRes,
    pendingBookingsRes,
    upcomingBookingsRes,
    recentBookingsRes,
    weekBeatsRes,
    monthBeatsRes,
    recentBeatsRes,
    monthMediaRes,
    todaySignupsRes,
    outstandingRemaindersRes,
  ] = await Promise.all([
    // Today's bookings (confirmed/completed)
    serviceClient
      .from('bookings')
      .select('id, total_amount, deposit_amount, actual_deposit_paid, remainder_amount, stripe_payment_intent_id, status')
      .gte('start_time', todayStart)
      .lt('start_time', todayEnd)
      .in('status', ['confirmed', 'completed', 'pending', 'pending_approval']),

    // This week bookings
    serviceClient
      .from('bookings')
      .select('id, total_amount, deposit_amount, actual_deposit_paid, remainder_amount, stripe_payment_intent_id, status')
      .gte('start_time', weekStart)
      .lt('start_time', todayEnd)
      .in('status', ['confirmed', 'completed', 'pending', 'pending_approval']),

    // This month bookings
    serviceClient
      .from('bookings')
      .select('id, total_amount, deposit_amount, actual_deposit_paid, remainder_amount, stripe_payment_intent_id, status')
      .gte('start_time', monthStart)
      .lt('start_time', todayEnd)
      .in('status', ['confirmed', 'completed', 'pending', 'pending_approval']),

    // Pending bookings count
    serviceClient
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'pending_approval']),

    // Upcoming sessions (next 7 days)
    serviceClient
      .from('bookings')
      .select('id')
      .gte('start_time', nowISO)
      .lt('start_time', weekFromNow)
      .in('status', ['confirmed', 'pending', 'pending_approval']),

    // Recent 5 bookings
    serviceClient
      .from('bookings')
      .select('id, customer_name, start_time, status, total_amount, created_at')
      .order('created_at', { ascending: false })
      .limit(5),

    // Beat purchases this week
    serviceClient
      .from('beat_purchases')
      .select('id, amount_paid')
      .gte('created_at', weekStart),

    // Beat purchases this month
    serviceClient
      .from('beat_purchases')
      .select('id, amount_paid')
      .gte('created_at', monthStart),

    // Recent 3 beat sales
    serviceClient
      .from('beat_purchases')
      .select('id, buyer_email, license_type, amount_paid, created_at, beats(title, producer)')
      .order('created_at', { ascending: false })
      .limit(3),

    // Media sales this month
    serviceClient
      .from('media_sales')
      .select('id, amount')
      .gte('created_at', monthStart),

    // Signups today
    serviceClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart)
      .lt('created_at', todayEnd),

    // Outstanding remainders (confirmed bookings with remainder > 0)
    serviceClient
      .from('bookings')
      .select('remainder_amount')
      .in('status', ['confirmed', 'pending', 'pending_approval'])
      .gt('remainder_amount', 0),
  ]);

  // Calculate revenue from bookings (deposits received)
  const calcRevenue = (bookings: any[] | null) => {
    if (!bookings) return 0;
    return bookings.reduce((sum, b) => {
      const deposit = depositCollectedCents(b);
      return sum + deposit;
    }, 0);
  };

  const todayBookings = todayBookingsRes.data || [];
  const weekBookings = weekBookingsRes.data || [];
  const monthBookings = monthBookingsRes.data || [];
  const weekBeats = weekBeatsRes.data || [];
  const monthBeats = monthBeatsRes.data || [];
  const monthMedia = monthMediaRes.data || [];

  const outstandingTotal = (outstandingRemaindersRes.data || []).reduce(
    (sum: number, b: any) => sum + (b.remainder_amount || 0),
    0
  );

  return NextResponse.json({
    today: {
      sessions: todayBookings.length,
      revenue: calcRevenue(todayBookings),
      signups: todaySignupsRes.count ?? 0,
    },
    week: {
      sessions: weekBookings.length,
      revenue: calcRevenue(weekBookings),
      beatsSold: weekBeats.length,
      beatsRevenue: weekBeats.reduce((s: number, b: any) => s + (b.amount_paid || 0), 0),
    },
    month: {
      sessions: monthBookings.length,
      revenue: calcRevenue(monthBookings),
      beatsSold: monthBeats.length,
      beatsRevenue: monthBeats.reduce((s: number, b: any) => s + (b.amount_paid || 0), 0),
      mediaSales: monthMedia.length,
      mediaRevenue: monthMedia.reduce((s: number, m: any) => s + (m.amount || 0), 0),
    },
    status: {
      pendingBookings: pendingBookingsRes.count ?? 0,
      upcomingSessions: (upcomingBookingsRes.data || []).length,
      outstandingRemainders: outstandingTotal,
    },
    recentBookings: (recentBookingsRes.data || []).map((b: any) => ({
      id: b.id,
      name: b.customer_name,
      date: b.start_time,
      status: b.status,
      amount: b.total_amount,
    })),
    recentBeatSales: (recentBeatsRes.data || []).map((p: any) => ({
      id: p.id,
      buyer: p.buyer_email,
      title: p.beats?.title || 'Unknown',
      producer: p.beats?.producer || 'Unknown',
      license: p.license_type,
      amount: p.amount_paid,
      date: p.created_at,
    })),
  });
}
