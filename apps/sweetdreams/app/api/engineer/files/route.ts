import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

// GET — list all files this engineer has uploaded (or all files if admin)
export async function GET() {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const serviceClient = createServiceClient();

  // Fetch all deliverables (engineers/admins can see all)
  const { data: deliverables, error } = await serviceClient
    .from('deliverables')
    .select('id, file_name, display_name, file_path, file_type, file_size, uploaded_by_name, description, created_at, user_id')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get client names for each user_id
  const userIds = [...new Set((deliverables || []).map(d => d.user_id))];
  const { data: profiles } = await serviceClient
    .from('profiles')
    .select('user_id, display_name, email')
    .in('user_id', userIds);

  const profileMap = new Map((profiles || []).map(p => [p.user_id, p.display_name || p.email || 'Unknown']));

  const files = (deliverables || []).map(d => ({
    ...d,
    client_name: profileMap.get(d.user_id) || 'Unknown Client',
  }));

  return NextResponse.json({ files });
}
