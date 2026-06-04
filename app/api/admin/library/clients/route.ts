import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess, verifyMediaManagerAccess, isAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  // Engineers, admins, AND media managers can browse the client directory —
  // media managers need it for the team-initiated media session flow (Phase 7).
  const hasAccess = (await verifyEngineerAccess(supabase)) || (await verifyMediaManagerAccess(supabase));
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Balance-edit UI should only render for super-admins. Engineers see the
  // CRM but cannot mutate remainder amounts (finance-sensitive action).
  const { data: { user: viewer } } = await supabase.auth.getUser();
  const viewerIsAdmin = isAdmin(viewer?.email);

  const { searchParams } = new URL(request.url);
  const detailed = searchParams.get('detailed') === 'true';

  // Get all profiles with their file and note counts
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, user_id, display_name, profile_picture_url, public_profile_slug, role, email, is_producer, producer_name')
    .order('display_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get file counts per user
  const { data: fileCounts } = await supabase
    .from('deliverables')
    .select('user_id');

  // Get note counts per user
  const { data: noteCounts } = await supabase
    .from('library_notes')
    .select('user_id');

  const fileCountMap: Record<string, number> = {};
  fileCounts?.forEach((f) => {
    fileCountMap[f.user_id] = (fileCountMap[f.user_id] || 0) + 1;
  });

  const noteCountMap: Record<string, number> = {};
  noteCounts?.forEach((n) => {
    noteCountMap[n.user_id] = (noteCountMap[n.user_id] || 0) + 1;
  });

  // If detailed, fetch all bookings and aggregate per email
  let bookingAggregates: Record<string, {
    session_count: number;
    total_revenue: number;
    last_session: string | null;
    phone: string | null;
    engineers: string[];
    outstanding_balance: number;
  }> = {};

  if (detailed) {
    const { data: bookings } = await supabase
      .from('bookings')
      .select('customer_email, customer_phone, engineer_name, start_time, total_amount, remainder_amount, status')
      .not('status', 'eq', 'cancelled');

    if (bookings) {
      const grouped: Record<string, typeof bookings> = {};
      for (const b of bookings) {
        const email = b.customer_email?.toLowerCase();
        if (!email) continue;
        if (!grouped[email]) grouped[email] = [];
        grouped[email].push(b);
      }

      for (const [email, group] of Object.entries(grouped)) {
        const confirmedOrCompleted = group.filter(b =>
          ['confirmed', 'completed', 'approved'].includes(b.status)
        );
        const engineerSet = new Set<string>();
        let lastSession: string | null = null;
        let phone: string | null = null;
        let totalRevenue = 0;
        let outstandingBalance = 0;

        for (const b of group) {
          if (b.engineer_name) engineerSet.add(b.engineer_name);
          if (b.start_time && (!lastSession || b.start_time > lastSession)) {
            lastSession = b.start_time;
          }
          if (b.customer_phone) phone = b.customer_phone;
        }

        for (const b of confirmedOrCompleted) {
          totalRevenue += b.total_amount || 0;
        }

        for (const b of group) {
          if ((b.remainder_amount || 0) > 0) {
            outstandingBalance += b.remainder_amount || 0;
          }
        }

        bookingAggregates[email] = {
          session_count: group.length,
          total_revenue: totalRevenue,
          last_session: lastSession,
          phone,
          engineers: [...engineerSet],
          outstanding_balance: outstandingBalance,
        };
      }
    }
  }

  const clients = profiles?.map((p) => {
    const base = {
      id: p.id,
      user_id: p.user_id,
      display_name: p.display_name,
      profile_picture_url: p.profile_picture_url,
      public_profile_slug: p.public_profile_slug,
      role: p.role || 'user',
      email: p.email,
      is_producer: p.is_producer || false,
      producer_name: p.producer_name,
      files_count: fileCountMap[p.user_id] || 0,
      notes_count: noteCountMap[p.user_id] || 0,
    };

    if (detailed && p.email) {
      const agg = bookingAggregates[p.email.toLowerCase()];
      return {
        ...base,
        session_count: agg?.session_count || 0,
        total_revenue: agg?.total_revenue || 0,
        last_session: agg?.last_session || null,
        phone: agg?.phone || null,
        engineers: agg?.engineers || [],
        outstanding_balance: agg?.outstanding_balance || 0,
      };
    }

    return base;
  }) || [];

  return NextResponse.json({ clients, viewer_is_admin: viewerIsAdmin });
}
