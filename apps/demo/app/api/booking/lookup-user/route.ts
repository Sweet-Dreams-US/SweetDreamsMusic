import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = new URL(request.url).searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const serviceClient = createServiceClient();

  // 1. Check profiles table for email match
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .single();

  if (profile?.user_id) {
    return NextResponse.json({ userId: profile.user_id });
  }

  // 2. Query auth.users directly via raw SQL for email match
  const { data: authMatch } = await serviceClient
    .rpc('lookup_user_by_email', { lookup_email: email });

  if (authMatch) {
    return NextResponse.json({ userId: authMatch });
  }

  // 3. Fallback: search profiles joined with bookings by customer_email
  const { data: booking } = await serviceClient
    .from('bookings')
    .select('customer_email')
    .eq('customer_email', email)
    .limit(1)
    .single();

  if (booking) {
    // Find profile by matching on auth email — use admin listUsers with filter
    // This is a last resort
    const { data: listData } = await serviceClient.auth.admin.listUsers({
      perPage: 1,
    });

    // Search through users for email match
    const matchedUser = listData?.users?.find(u => u.email === email);
    if (matchedUser) {
      return NextResponse.json({ userId: matchedUser.id });
    }
  }

  return NextResponse.json({ userId: null });
}
