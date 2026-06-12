import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { SITE_URL, BEAT_LICENSES } from '@/lib/constants';

// POST — create a Stripe checkout to upgrade a lease (pay the difference)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { purchaseId, targetLicenseType } = await request.json();
  if (!purchaseId || !targetLicenseType) {
    return NextResponse.json({ error: 'purchaseId and targetLicenseType required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: purchase } = await service
    .from('beat_purchases')
    .select('*, beats(id, title, producer, trackout_lease_price, exclusive_price, has_exclusive, status)')
    .eq('id', purchaseId)
    .single();

  if (!purchase) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
  if (purchase.buyer_id !== user.id && purchase.buyer_email !== user.email) {
    return NextResponse.json({ error: 'Not your purchase' }, { status: 403 });
  }
  if (purchase.license_type === 'exclusive') {
    return NextResponse.json({ error: 'Already exclusive — nothing to upgrade to' }, { status: 400 });
  }
  if (purchase.revoked_at) {
    return NextResponse.json({ error: 'This lease has been revoked' }, { status: 400 });
  }

  const beat = Array.isArray(purchase.beats) ? purchase.beats[0] : purchase.beats;
  if (!beat) return NextResponse.json({ error: 'Beat not found' }, { status: 404 });

  // Validate target license type and get price
  let targetPrice: number | null = null;
  if (targetLicenseType === 'trackout_lease') {
    targetPrice = (beat as { trackout_lease_price: number | null }).trackout_lease_price;
  } else if (targetLicenseType === 'exclusive') {
    if (!(beat as { has_exclusive: boolean }).has_exclusive) {
      return NextResponse.json({ error: 'Exclusive rights are not available for this beat' }, { status: 400 });
    }
    if ((beat as { status: string }).status === 'sold_exclusive') {
      return NextResponse.json({ error: 'This beat has already been sold exclusively' }, { status: 400 });
    }
    targetPrice = (beat as { exclusive_price: number | null }).exclusive_price;
  } else {
    return NextResponse.json({ error: 'Invalid target license type' }, { status: 400 });
  }

  if (!targetPrice) {
    return NextResponse.json({ error: 'This license type is not available for this beat' }, { status: 400 });
  }

  // Calculate upgrade price (target - already paid, minimum $1)
  const upgradePrice = Math.max(100, targetPrice - purchase.amount_paid);
  const license = BEAT_LICENSES[targetLicenseType as keyof typeof BEAT_LICENSES];

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `License Upgrade — ${(beat as { title: string }).title}`,
          description: `Upgrade from ${BEAT_LICENSES[purchase.license_type as keyof typeof BEAT_LICENSES]?.name || purchase.license_type} to ${license?.name || targetLicenseType}`,
        },
        unit_amount: upgradePrice,
      },
      quantity: 1,
    }],
    customer_email: user.email || purchase.buyer_email,
    metadata: {
      type: 'beat_upgrade',
      original_purchase_id: purchaseId,
      beat_id: purchase.beat_id,
      beat_title: (beat as { title: string }).title,
      producer: (beat as { producer: string }).producer,
      license_type: targetLicenseType,
      original_license_type: purchase.license_type,
      buyer_id: user.id,
      buyer_email: user.email || purchase.buyer_email,
    },
    success_url: `${SITE_URL}/dashboard/purchases?upgraded=true`,
    cancel_url: `${SITE_URL}/dashboard/purchases`,
  });

  return NextResponse.json({ url: session.url });
}
