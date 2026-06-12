import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyProducerAccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const serviceClient = createServiceClient();

  // Get all beats by this producer
  const { data: producerBeats } = await serviceClient
    .from('beats')
    .select('id')
    .eq('producer_id', profileId);

  if (!producerBeats || producerBeats.length === 0) {
    return NextResponse.json({ sales: [] });
  }

  const beatIds = producerBeats.map((b) => b.id);

  let query = serviceClient
    .from('beat_purchases')
    .select('id, beat_id, buyer_email, license_type, amount_paid, created_at, beats(title)')
    .in('beat_id', beatIds)
    .order('created_at', { ascending: false });

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data: sales, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sales: sales || [] });
}
