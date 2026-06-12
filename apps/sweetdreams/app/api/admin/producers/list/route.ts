import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

export async function GET() {
  const supabase = await createClient();
  const hasAccess = await verifyAdminAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: producers, error } = await supabase
    .from('profiles')
    .select('id, user_id, display_name, producer_name, profile_picture_url, public_profile_slug')
    .eq('is_producer', true)
    .order('producer_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ producers: producers || [] });
}
