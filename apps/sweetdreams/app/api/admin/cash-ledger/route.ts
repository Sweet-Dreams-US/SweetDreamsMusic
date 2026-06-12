import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

// GET — list all cash ledger entries, grouped by engineer
export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 401 });

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('cash_ledger')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data || [] });
}

// POST — mark cash as collected from engineer
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  const { entryId, note } = await request.json();

  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 });

  const serviceClient = createServiceClient();
  const { error } = await serviceClient
    .from('cash_ledger')
    .update({
      status: 'collected',
      collected_at: new Date().toISOString(),
      collected_note: note || `Collected by ${user?.email || 'admin'}`,
    })
    .eq('id', entryId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
