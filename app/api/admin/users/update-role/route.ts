import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyAdminAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { profileId, role, is_producer } = await request.json();

  if (!profileId) {
    return NextResponse.json({ error: 'profileId required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const updates: Record<string, unknown> = {};

  if (role !== undefined) {
    if (!['user', 'engineer', 'admin', 'media_manager', 'agent'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    updates.role = role;
  }

  if (is_producer !== undefined) {
    updates.is_producer = is_producer;
    if (is_producer) {
      updates.producer_approved_at = new Date().toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  const { error } = await serviceClient
    .from('profiles')
    .update(updates)
    .eq('id', profileId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
