import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

/**
 * GET /api/users/search?q=… — search platform accounts by name or email
 * (engineer OR admin). Powers the "Move to another account" picker so staff can
 * search through existing users instead of typing an exact email. Returns up to
 * 12 matches: { userId, displayName, email }. Only accounts with an email are
 * returned (the email is what a booking links to).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyEngineerAccess(supabase))) {
    return NextResponse.json({ error: 'Engineer or admin access required' }, { status: 401 });
  }

  const raw = (new URL(request.url).searchParams.get('q') || '').trim();
  if (raw.length < 2) return NextResponse.json({ users: [] });

  // Strip characters that would break the PostgREST .or() filter grammar
  // (commas split conditions; parens/wildcards are operators).
  const q = raw.replace(/[,%()*]/g, '').trim();
  if (q.length < 2) return NextResponse.json({ users: [] });

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .select('user_id, display_name, email')
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order('display_name', { ascending: true })
    .limit(12);

  if (error) {
    console.error('[users/search] error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }

  const users = (data || [])
    .filter((u: { email: string | null }) => !!u.email)
    .map((u: { user_id: string; display_name: string | null; email: string }) => ({
      userId: u.user_id, displayName: u.display_name, email: u.email,
    }));
  return NextResponse.json({ users });
}
