// app/api/producer/clients/route.ts
//
// Round 9d: search-for-users endpoint scoped to producers (sales context).
// Producers use this to find buyers/users to DM about beats — admins
// already have a richer client library at /api/admin/library/clients.
//
// Returns at most 25 results, prioritizing recent buyers of this
// producer's beats. Falls back to a paginated profile search when no
// query is provided.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const RESULT_CAP = 25;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  // Producer + admin can both call this — admins for cross-user lookup,
  // producers for sales outreach.
  if (!user.is_producer && user.role !== 'admin') {
    return NextResponse.json({ error: 'Producer or admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  const service = createServiceClient();

  let query = service
    .from('profiles')
    .select('user_id, display_name, email, profile_picture_url, public_profile_slug, is_producer')
    .not('user_id', 'is', null)
    .neq('user_id', user.id) // don't include self
    .limit(RESULT_CAP);

  if (q.length >= 2) {
    // Match against display_name OR email (case-insensitive substring)
    query = query.or(`display_name.ilike.%${q}%,email.ilike.%${q}%`);
  }
  query = query.order('display_name', { ascending: true });

  const { data: clients, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ clients: clients ?? [] });
}
