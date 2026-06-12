// app/api/quotes/[token]/accept/route.ts
//
// POST — recipient accepts a quote → creates a Stripe Checkout Session
// and returns the URL for client-side redirect. Authenticated; the
// logged-in user must match the quote's user_id (solo) or be a band
// admin (band).
//
// Round D: payment integration
//   - One-off: Checkout Session in `mode: 'payment'` for the total price
//   - Membership: Checkout Session in `mode: 'subscription'` with a
//     recurring price + cancel_at = end-of-term so Stripe stops billing
//     after the contract iterations
//
// The actual entitlement minting + status flip from sent→accepted
// happens in the Stripe webhook on checkout.session.completed. We don't
// flip status here — if the customer abandons the checkout page, the
// quote stays in 'sent' and they can come back to it.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { SITE_URL } from '@/lib/constants';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: 'You must be signed in to accept a quote.' },
      { status: 401 },
    );
  }

  const { token } = await params;
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const service = createServiceClient();

  // ── Pull quote + template + lines in a single hop ──────────────────
  const { data: quoteRow, error: qErr } = await service
    .from('package_quotes')
    .select('id, template_id, user_id, band_id, status, total_price_cents, expires_at, stripe_checkout_session_id')
    .eq('token', token)
    .maybeSingle();
  if (qErr || !quoteRow) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  type Quote = {
    id: string; template_id: string; user_id: string | null; band_id: string | null;
    status: string; total_price_cents: number; expires_at: string | null;
    stripe_checkout_session_id: string | null;
  };
  const quote = quoteRow as Quote;

  // ── Status checks ──────────────────────────────────────────────────
  if (quote.status === 'accepted') {
    return NextResponse.json({ ok: true, alreadyAccepted: true });
  }
  if (quote.status === 'declined') {
    return NextResponse.json(
      { error: 'This quote was declined. Ask admin for a new one.' },
      { status: 400 },
    );
  }
  if (quote.status === 'expired' || (quote.expires_at && new Date(quote.expires_at) < new Date())) {
    return NextResponse.json(
      { error: 'This quote has expired. Ask admin for a new one.' },
      { status: 400 },
    );
  }
  if (quote.status === 'draft') {
    return NextResponse.json(
      { error: 'This quote has not been sent yet.' },
      { status: 400 },
    );
  }

  // ── Authorization ──────────────────────────────────────────────────
  if (quote.user_id) {
    if (user.id !== quote.user_id) {
      return NextResponse.json(
        { error: 'This quote was sent to a different account.' },
        { status: 403 },
      );
    }
  } else if (quote.band_id) {
    const { data: membership } = await service
      .from('band_members')
      .select('role')
      .eq('band_id', quote.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    type BM = { role: string };
    const m = membership as BM | null;
    if (!m || m.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only band admins can accept band quotes.' },
        { status: 403 },
      );
    }
  } else {
    return NextResponse.json({ error: 'Quote has no recipient' }, { status: 500 });
  }

  // ── Pull template for shape (one-off vs membership) + name ─────────
  const { data: tplRow } = await service
    .from('package_templates')
    .select('name, is_membership, membership_months, duration_days, price_cents')
    .eq('id', quote.template_id)
    .maybeSingle();
  if (!tplRow) {
    return NextResponse.json({ error: 'Template missing' }, { status: 500 });
  }
  type Tpl = {
    name: string;
    is_membership: boolean;
    membership_months: number | null;
    duration_days: number | null;
    price_cents: number;
  };
  const tpl = tplRow as Tpl;

  // ── Build the Checkout Session ─────────────────────────────────────
  const successUrl = `${SITE_URL}/quotes/${token}?status=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${SITE_URL}/quotes/${token}?status=cancelled`;
  const metadata: Record<string, string> = {
    type: 'package_quote',
    quote_id: quote.id,
    template_id: quote.template_id,
    template_name: tpl.name,
    is_membership: String(tpl.is_membership),
    accepted_by_user_id: user.id,
  };
  if (quote.user_id) metadata.recipient_user_id = quote.user_id;
  if (quote.band_id) metadata.recipient_band_id = quote.band_id;

  try {
    let checkoutSessionUrl: string | null = null;

    if (tpl.is_membership) {
      // ── Membership: subscription mode ────────────────────────────
      // Create a one-off Stripe Price tied to a one-off Product. Stripe
      // doesn't have a clean "use template" abstraction — so each quote
      // gets its own price object with this membership's per-month
      // amount, plus the iterations cap so billing stops after the
      // contract is paid out.
      const product = await stripe.products.create({
        name: `${tpl.name} (Membership)`,
        metadata: { quote_id: quote.id, template_id: quote.template_id },
      });
      const price = await stripe.prices.create({
        unit_amount: tpl.price_cents,
        currency: 'usd',
        recurring: { interval: 'month' },
        product: product.id,
      });

      // Stripe's checkout-session SDK type doesn't expose `cancel_at`
      // on subscription_data. Workaround: don't cap here. The webhook
      // sets `cancel_at` on the subscription itself once it's created
      // (checkout.session.completed → stripe.subscriptions.update).
      // That guarantees the membership stops billing after the contract
      // term and never auto-renews — per Cole's locked-in rule.
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: user.email,
        subscription_data: {
          metadata: {
            quote_id: quote.id,
            template_id: quote.template_id,
            type: 'package_membership',
            // Snapshot the term so the webhook can compute cancel_at
            // without re-fetching the template.
            membership_months: String(tpl.membership_months ?? 3),
          },
        },
        metadata,
      });
      checkoutSessionUrl = session.url;

      // Stamp the session id on the quote for traceability.
      await service
        .from('package_quotes')
        .update({ stripe_checkout_session_id: session.id })
        .eq('id', quote.id);
    } else {
      // ── One-off: payment mode ────────────────────────────────────
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: quote.total_price_cents,
            product_data: {
              name: tpl.name,
              metadata: { quote_id: quote.id, template_id: quote.template_id },
            },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: user.email,
        metadata,
      });
      checkoutSessionUrl = session.url;

      await service
        .from('package_quotes')
        .update({ stripe_checkout_session_id: session.id })
        .eq('id', quote.id);
    }

    if (!checkoutSessionUrl) {
      return NextResponse.json({ error: 'Stripe did not return a checkout URL.' }, { status: 500 });
    }

    return NextResponse.json({ checkout_url: checkoutSessionUrl });
  } catch (e) {
    console.error('[quotes/accept] Stripe error:', e);
    const msg = e instanceof Error ? e.message : 'Stripe checkout creation failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
