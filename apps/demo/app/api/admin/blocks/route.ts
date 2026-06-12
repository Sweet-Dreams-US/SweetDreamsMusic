import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

// GET — list upcoming block-off times
export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const serviceClient = createServiceClient();
  const { data: blocks, error } = await serviceClient
    .from('studio_blocks')
    .select('*')
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ blocks: blocks || [] });
}

// POST — create a block-off time
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  const { date, startTime, endTime, reason } = await request.json();

  if (!date || !startTime || !endTime) {
    return NextResponse.json({ error: 'date, startTime, and endTime are required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { data: block, error } = await serviceClient
    .from('studio_blocks')
    .insert({
      start_time: `${date}T${startTime}:00+00:00`,
      end_time: `${date}T${endTime}:00+00:00`,
      reason: reason || null,
      created_by: user?.email || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ block });
}

// DELETE — remove a block-off time
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from('studio_blocks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
