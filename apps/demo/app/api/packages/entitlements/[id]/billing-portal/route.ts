// app/api/packages/entitlements/[id]/billing-portal/route.ts
//
// POST — generate a Stripe Billing Portal session URL for a membership
// entitlement. Used so customers can update their card if a payment
// fails (entitlement.payment_status='past_due' surfaces a warning;
// this gives them a way to fix it).
//
// Auth: caller must own the entitlement (user_id) or be a band admin.
// Only membership entitlements with a stripe_subscription_id are
// eligible — one-off entitlements have no recurring billing to manage.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { SITE_URL } from '@/lib/constants';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: entitlementId } = await params;
  if (!entitlementId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const service = createServiceClient();

  const { data: entRow, error } = await service
    .from('package_entitlements')
    .select('id, user_id, band_id, stripe_subscription_id')
    .eq('id', entitlementId)
    .maybeSingle();
  if (error || !entRow) {
    return NextResponse.json({ error: 'Entitlement not found' }, { status: 404 });
  }
  type Ent = { id: string; user_id: string | null; band_id: string | null; stripe_subscription_id: string | null };
  const ent = entRow as Ent;

  if (!ent.stripe_subscription_id) {
    return NextResponse.json(
      { error: 'No subscription to manage. One-off packages have nothing to update.' },
      { status: 400 },
    );
  }

  // Authorize.
  let authorized = false;
  if (ent.user_id && ent.user_id === user.id) authorized = true;
  else if (ent.band_id) {
    const { data: m } = await service
      .from('band_members')
      .select('role')
      .eq('band_id', ent.band_id)
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    if (m) authorized = true;
  }
  if (!authorized) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  // Get the Stripe customer id from the subscription. We don't store
  // it on our entitlement row — Stripe is the source of truth here.
  let customerId: string;
  try {
    const sub = await stripe.subscriptions.retrieve(ent.stripe_subscription_id);
    customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  } catch (e) {
    console.error('[billing-portal] subscription retrieve:', e);
    return NextResponse.json({ error: 'Could not look up subscription.' }, { status: 500 });
  }

  // Mint the portal session.
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${SITE_URL}/dashboard/hub`,
    });
    return NextResponse.json({ portal_url: portalSession.url });
  } catch (e) {
    console.error('[billing-portal] portal session create:', e);
    const msg = e instanceof Error ? e.message : 'Stripe portal creation failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
