import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { depositCollectedCents } from '@/lib/deposit';

export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sc = createServiceClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalUsersRes,
    newUsersMonthRes,
    totalDeliverablesRes,
    deliverablesMonthRes,
    totalBookingsRes,
    bookingsMonthRes,
    bookingsByStatusRes,
    totalBeatPurchasesRes,
    beatRevenueRes,
    beatRevenueMonthRes,
    blogPostsRes,
    blogViewsRes,
    activeBeatCountRes,
    publicProfilesRes,
    topClientsRes,
    topBlogPostsRes,
    mediaSalesTotalRes,
    mediaRevenueMonthRes,
    bookingRevenueMonthRes,
    fileDownloadsRes,
    activeUsersWeekRes,
    eventsByTypeRes,
  ] = await Promise.all([
    // Total users
    sc.from('profiles').select('id', { count: 'exact', head: true }),

    // New users this month
    sc.from('profiles').select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart),

    // Total deliverables
    sc.from('deliverables').select('id', { count: 'exact', head: true }),

    // Deliverables uploaded this month
    sc.from('deliverables').select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart),

    // Total bookings
    sc.from('bookings').select('id', { count: 'exact', head: true }),

    // Bookings this month
    sc.from('bookings').select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart),

    // Bookings by status
    sc.from('bookings').select('status'),

    // Total beat purchases
    sc.from('beat_purchases').select('id', { count: 'exact', head: true }),

    // Total beat revenue
    sc.from('beat_purchases').select('amount_paid'),

    // Beat revenue this month
    sc.from('beat_purchases').select('amount_paid')
      .gte('created_at', monthStart),

    // Blog posts published
    sc.from('blog_posts').select('id', { count: 'exact', head: true })
      .eq('status', 'published'),

    // Blog total views
    sc.from('blog_posts').select('view_count'),

    // Active beats in store
    sc.from('beats').select('id', { count: 'exact', head: true })
      .eq('status', 'active'),

    // Public profiles
    sc.from('profiles').select('id', { count: 'exact', head: true })
      .not('public_profile_slug', 'is', null),

    // Top 5 clients by session count
    sc.from('bookings').select('customer_name, customer_email'),

    // Top 5 blog posts by views
    sc.from('blog_posts').select('title, slug, view_count')
      .eq('status', 'published')
      .order('view_count', { ascending: false })
      .limit(5),

    // Total media sales count
    sc.from('media_sales').select('id', { count: 'exact', head: true }),

    // Media revenue this month
    sc.from('media_sales').select('amount')
      .gte('created_at', monthStart),

    // Booking revenue this month (deposits)
    sc.from('bookings').select('actual_deposit_paid, deposit_amount, remainder_amount, stripe_payment_intent_id')
      .gte('created_at', monthStart)
      .in('status', ['confirmed', 'completed', 'pending', 'pending_approval']),

    // File downloads from analytics
    sc.from('platform_analytics').select('id', { count: 'exact', head: true })
      .eq('event_type', 'file_download'),

    // Active users this week
    sc.from('platform_analytics').select('user_id')
      .gte('created_at', weekAgo)
      .not('user_id', 'is', null),

    // Feature usage by event type
    sc.from('platform_analytics').select('event_type'),
  ]);

  // Aggregate bookings by status
  const statusCounts: Record<string, number> = {};
  (bookingsByStatusRes.data || []).forEach((b: { status: string }) => {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  });

  // Total beat revenue
  const totalBeatRevenue = (beatRevenueRes.data || []).reduce(
    (sum: number, b: { amount_paid: number }) => sum + (b.amount_paid || 0), 0
  );

  // Beat revenue this month
  const beatRevenueMonth = (beatRevenueMonthRes.data || []).reduce(
    (sum: number, b: { amount_paid: number }) => sum + (b.amount_paid || 0), 0
  );

  // Blog total views
  const totalBlogViews = (blogViewsRes.data || []).reduce(
    (sum: number, b: { view_count: number | null }) => sum + (b.view_count || 0), 0
  );

  // Media revenue this month
  const mediaRevenueMonth = (mediaRevenueMonthRes.data || []).reduce(
    (sum: number, m: { amount: number }) => sum + (m.amount || 0), 0
  );

  // Booking revenue this month
  const bookingRevenueMonth = (bookingRevenueMonthRes.data || []).reduce(
    (sum: number, b: { actual_deposit_paid: number | null; deposit_amount: number; remainder_amount: number | null; stripe_payment_intent_id: string | null }) =>
      sum + depositCollectedCents(b), 0
  );

  // Top 5 clients by session count
  const clientCounts: Record<string, { name: string; email: string; count: number }> = {};
  (topClientsRes.data || []).forEach((b: { customer_name: string; customer_email: string }) => {
    const key = b.customer_email || b.customer_name;
    if (!clientCounts[key]) {
      clientCounts[key] = { name: b.customer_name, email: b.customer_email, count: 0 };
    }
    clientCounts[key].count++;
  });
  const topClients = Object.values(clientCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Active users this week (distinct user_ids)
  const uniqueUserIds = new Set(
    (activeUsersWeekRes.data || []).map((r: { user_id: string }) => r.user_id)
  );

  // Feature usage counts
  const eventCounts: Record<string, number> = {};
  (eventsByTypeRes.data || []).forEach((r: { event_type: string }) => {
    eventCounts[r.event_type] = (eventCounts[r.event_type] || 0) + 1;
  });

  const revenueThisMonth = bookingRevenueMonth + beatRevenueMonth + mediaRevenueMonth;

  return NextResponse.json({
    totals: {
      users: totalUsersRes.count ?? 0,
      bookings: totalBookingsRes.count ?? 0,
      deliverables: totalDeliverablesRes.count ?? 0,
      beatPurchases: totalBeatPurchasesRes.count ?? 0,
      beatRevenue: totalBeatRevenue,
      mediaSales: mediaSalesTotalRes.count ?? 0,
      fileDownloads: fileDownloadsRes.count ?? 0,
    },
    thisMonth: {
      newUsers: newUsersMonthRes.count ?? 0,
      bookings: bookingsMonthRes.count ?? 0,
      deliverables: deliverablesMonthRes.count ?? 0,
      revenue: revenueThisMonth,
      bookingRevenue: bookingRevenueMonth,
      beatRevenue: beatRevenueMonth,
      mediaRevenue: mediaRevenueMonth,
    },
    content: {
      blogPostsPublished: blogPostsRes.count ?? 0,
      totalBlogViews: totalBlogViews,
      activeBeats: activeBeatCountRes.count ?? 0,
      publicProfiles: publicProfilesRes.count ?? 0,
    },
    bookingsByStatus: statusCounts,
    activeUsersThisWeek: uniqueUserIds.size,
    featureUsage: eventCounts,
    topClients,
    topBlogPosts: (topBlogPostsRes.data || []).map((p: { title: string; slug: string; view_count: number | null }) => ({
      title: p.title,
      slug: p.slug,
      views: p.view_count || 0,
    })),
  });
}
