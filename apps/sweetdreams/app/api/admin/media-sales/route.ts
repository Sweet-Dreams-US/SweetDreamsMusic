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

// POST — create a new media sale
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();

  const body = await request.json();
  const { description, amount, saleType, soldBy, filmedBy, editedBy, clientName, clientEmail, notes } = body;

  if (!description || !amount) {
    return NextResponse.json({ error: 'Description and amount are required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { data: sale, error } = await serviceClient
    .from('media_sales')
    .insert({
      description,
      amount: Math.round(amount * 100), // convert dollars to cents
      sale_type: saleType || 'video',
      sold_by: soldBy || null,
      filmed_by: filmedBy || null,
      edited_by: editedBy || null,
      engineer_name: soldBy || '', // backward compat — primary engineer
      client_name: clientName || null,
      client_email: clientEmail || null,
      notes: notes || null,
      created_by: user?.id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sale });
}

// PUT — update an existing media sale
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { id, description, amount, saleType, soldBy, filmedBy, editedBy, clientName, clientEmail, notes } = body;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!description || amount === undefined) return NextResponse.json({ error: 'Description and amount required' }, { status: 400 });

  const serviceClient = createServiceClient();
  const { data: sale, error } = await serviceClient
    .from('media_sales')
    .update({
      description,
      amount: Math.round(amount * 100),
      sale_type: saleType || 'video',
      sold_by: soldBy || null,
      filmed_by: filmedBy || null,
      edited_by: editedBy || null,
      engineer_name: soldBy || '',
      client_name: clientName || null,
      client_email: clientEmail || null,
      notes: notes || null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sale });
}

// DELETE — remove a media sale
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from('media_sales').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
