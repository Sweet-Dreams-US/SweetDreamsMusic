import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { SITE_URL, RENEWAL_DISCOUNT, BEAT_LICENSES } from '@/lib/constants';

// POST — create a Stripe checkout for lease renewal at 75% of original price
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { purchaseId } = await request.json();
  if (!purchaseId) return NextResponse.json({ error: 'purchaseId required' }, { status: 400 });

  const service = createServiceClient();
  const { data: purchase } = await service
    .from('beat_purchases')
    .select('*, beats(title, producer)')
    .eq('id', purchaseId)
    .single();

  if (!purchase) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
  if (purchase.buyer_id !== user.id && purchase.buyer_email !== user.email) {
    return NextResponse.json({ error: 'Not your purchase' }, { status: 403 });
  }
  if (purchase.license_type === 'exclusive') {
    return NextResponse.json({ error: 'Exclusive licenses do not expire' }, { status: 400 });
  }
  if (purchase.renewal_blocked) {
    return NextResponse.json({ error: 'This lease cannot be renewed — exclusive rights were purchased by another buyer' }, { status: 400 });
  }
  if (purchase.revoked_at) {
    return NextResponse.json({ error: 'This lease has been revoked' }, { status: 400 });
  }

  const beat = Array.isArray(purchase.beats) ? purchase.beats[0] : purchase.beats;
  const renewalPrice = Math.round(purchase.amount_paid * RENEWAL_DISCOUNT);
  const license = BEAT_LICENSES[purchase.license_type as keyof typeof BEAT_LICENSES];

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Lease Renewal — ${(beat as { title: string })?.title || 'Beat'}`,
          description: `Renew your ${license?.name || purchase.license_type} (75% of original price)`,
        },
        unit_amount: renewalPrice,
      },
      quantity: 1,
    }],
    customer_email: user.email || purchase.buyer_email,
    metadata: {
      type: 'beat_renewal',
      original_purchase_id: purchaseId,
      beat_id: purchase.beat_id,
      license_type: purchase.license_type,
      buyer_id: user.id,
      buyer_email: user.email || purchase.buyer_email,
    },
    success_url: `${SITE_URL}/dashboard/purchases?renewed=true`,
    cancel_url: `${SITE_URL}/dashboard/purchases`,
  });

  return NextResponse.json({ url: session.url });
}
