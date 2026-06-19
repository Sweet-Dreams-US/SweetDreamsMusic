import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

// GET — list all media sales (with optional date range)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const serviceClient = createServiceClient();
  let query = serviceClient
    .from('media_sales')
    .select('*')
    .order('created_at', { ascending: false });

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', `${to}T23:59:59`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sales: data || [] });
}

// NOTE: Manual media-sales logging has been retired. The POST/PUT/DELETE
// handlers (create/edit/delete sales) were removed — media orders now flow
// through /media-team. The GET handler is kept intact because Accounting
// reads historical media_sales through it (and via the accounting route),
// so historical media revenue must not break.
