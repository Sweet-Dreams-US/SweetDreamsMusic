import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { SITE_URL, BEAT_LICENSES, type BeatLicenseType } from '@/lib/constants';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

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

  if (sale.status !== 'signed') {
    return NextResponse.json(
      { error: `Sale must be signed before checkout. Current status: ${sale.status}` },
      { status: 400 }
    );
  }

  if (!sale.requires_payment) {
    return NextResponse.json({ error: 'This sale does not require payment' }, { status: 400 });
  }

  const licenseType = sale.license_type as BeatLicenseType;
  const license = BEAT_LICENSES[licenseType];

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      automatic_tax: { enabled: true },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${sale.beat_title} — ${license.name}`,
              description: `Private sale — ${license.description}`,
              tax_code: 'txcd_10202000', // Digital goods - audio
            },
            unit_amount: sale.amount,
          },
          quantity: 1,
        },
      ],
      customer_email: sale.buyer_email,
      metadata: {
        type: 'private_beat_sale',
        private_sale_id: sale.id,
        beat_id: sale.beat_id || '',
        license_type: sale.license_type,
        producer_id: sale.producer_id || '',
        token,
      },
      success_url: `${SITE_URL}/beats/private/${token}?paid=true`,
      cancel_url: `${SITE_URL}/beats/private/${token}`,
    });

    // Store the checkout session ID
    await serviceClient
      .from('private_beat_sales')
      .update({
        stripe_checkout_session_id: session.id,
        status: 'awaiting_payment',
      })
      .eq('id', sale.id);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Private sale checkout error:', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
