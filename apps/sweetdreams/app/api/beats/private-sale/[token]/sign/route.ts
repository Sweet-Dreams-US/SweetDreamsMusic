import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generateLicenseText } from '@/lib/license-templates';
import { sendPrivateBeatSaleComplete } from '@/lib/email';
import { BEAT_LICENSES, type BeatLicenseType } from '@/lib/constants';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  // Require login
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required to sign agreements' }, { status: 401 });
  }

  // Get buyer profile for real name
  const { data: buyerProfile } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('user_id', user.id)
    .single();

  const buyerName = buyerProfile?.display_name || user.email?.split('@')[0] || 'Buyer';

  const serviceClient = createServiceClient();

  // Look up sale by token
  const { data: sale, error: saleError } = await serviceClient
    .from('private_beat_sales')
    .select('*')
    .eq('token', token)
    .single();

  if (saleError || !sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
  }

  if (sale.status !== 'pending') {
    return NextResponse.json({ error: `Sale is already ${sale.status}` }, { status: 400 });
  }

  // Capture IP and user agent
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  // Generate license text
  const licenseType = sale.license_type as BeatLicenseType;
  const license = BEAT_LICENSES[licenseType];
  const now = new Date();

  const agreementText = generateLicenseText({
    buyerName: buyerName,
    buyerEmail: user.email || sale.buyer_email,
    beatTitle: sale.beat_title,
    producerName: sale.beat_producer,
    licenseType,
    amountPaid: sale.amount,
    purchaseDate: now.toISOString().split('T')[0],
    purchaseId: sale.id,
  });

  // Update sale with signature
  const updateData: Record<string, unknown> = {
    signed_at: now.toISOString(),
    agreement_text: agreementText,
    agreement_ip: ip,
    agreement_user_agent: userAgent,
    status: 'signed',
  };

  // If no payment required, complete immediately
  if (!sale.requires_payment) {
    // Create beat_purchases row
    const { data: purchase, error: purchaseError } = await serviceClient
      .from('beat_purchases')
      .insert({
        beat_id: sale.beat_id || null,
        buyer_id: user.id,
        buyer_email: user.email || sale.buyer_email,
        license_type: sale.license_type,
        amount_paid: sale.amount,
        payment_method: sale.payment_method || 'private_sale',
        private_sale_id: sale.id,
      })
      .select('id')
      .single();

    if (purchaseError) {
      console.error('Failed to create purchase record:', purchaseError);
      return NextResponse.json({ error: 'Failed to complete sale' }, { status: 500 });
    }

    updateData.status = 'completed';
    updateData.purchase_id = purchase.id;
    updateData.completed_at = now.toISOString();

    // If exclusive, mark beat as sold
    if (licenseType === 'exclusive' && sale.beat_id) {
      await serviceClient
        .from('beats')
        .update({
          status: 'sold_exclusive',
          exclusive_sold_at: now.toISOString(),
        })
        .eq('id', sale.beat_id);
    }

    // Update sale
    const { error: updateError } = await serviceClient
      .from('private_beat_sales')
      .update(updateData)
      .eq('id', sale.id);

    if (updateError) {
      console.error('Failed to update sale:', updateError);
      return NextResponse.json({ error: 'Failed to update sale' }, { status: 500 });
    }

    // Send completion email
    await sendPrivateBeatSaleComplete(sale.buyer_email, {
      buyerName: sale.buyer_name,
      beatTitle: sale.beat_title,
      producerName: sale.beat_producer,
      licenseType: license.name,
      amount: sale.amount,
      token,
    });

    return NextResponse.json({
      status: 'completed',
      downloadUrl: `/api/beats/private-sale/${token}/download`,
    });
  }

  // Payment required — just sign and return checkout URL
  const { error: updateError } = await serviceClient
    .from('private_beat_sales')
    .update(updateData)
    .eq('id', sale.id);

  if (updateError) {
    console.error('Failed to update sale:', updateError);
    return NextResponse.json({ error: 'Failed to update sale' }, { status: 500 });
  }

  return NextResponse.json({
    status: 'signed',
    checkoutUrl: `/api/beats/private-sale/${token}/checkout`,
  });
}
