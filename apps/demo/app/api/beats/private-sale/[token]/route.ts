import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data: sale, error } = await serviceClient
    .from('private_beat_sales')
    .select('beat_title, beat_producer, license_type, amount, requires_payment, status, buyer_name, beat_id, signed_at, agreement_text')
    .eq('token', token)
    .single();

  if (error || !sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
  }

  // If there's a linked beat, fetch cover image
  let coverImageUrl: string | null = null;
  if (sale.beat_id) {
    const { data: beat } = await serviceClient
      .from('beats')
      .select('cover_image_url')
      .eq('id', sale.beat_id)
      .single();

    coverImageUrl = beat?.cover_image_url || null;
  }

  return NextResponse.json({
    beatTitle: sale.beat_title,
    beatProducer: sale.beat_producer,
    licenseType: sale.license_type,
    amount: sale.amount,
    requiresPayment: sale.requires_payment,
    status: sale.status,
    buyerName: sale.buyer_name,
    coverImageUrl,
    signedAt: sale.signed_at || null,
    hasAgreement: !!sale.agreement_text,
  });
}
