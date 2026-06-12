// app/api/packages/entitlements/route.ts
//
// GET — return the logged-in user's active package entitlements,
// including any band-owned entitlements for bands the user is a
// member of.
//
// Response shape feeds the Artist Hub's "Active Packages" panel.
// Each entitlement comes with its balances + template metadata so
// the UI renders without fan-out fetches.
//
// Auth: any logged-in user. Service-role under the hood (the package
// tables are RLS-locked to service role; we filter by the session
// user's identity in code).

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export interface EntitlementBalance {
  id: string;
  kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  media_offering_id: string | null;
  full_price_cents: number;
  package_value_cents: number;
  notes: string | null;
  quantity_granted: number;
  quantity_redeemed: number;
}

export interface ActiveEntitlement {
  id: string;
  template_id: string;
  user_id: string | null;
  band_id: string | null;
  band_name: string | null;
  status: 'active' | 'exhausted' | 'expired';
  payment_status: 'current' | 'past_due' | 'collections' | 'written_off';
  starts_at: string;
  ends_at: string;
  current_period_end: string | null;
  /** Present only for memberships that completed Stripe Checkout. UI uses
   *  this to decide whether to show the Stripe Billing Portal button. */
  has_stripe_subscription: boolean;
  template_name: string;
  template_description: string | null;
  template_is_membership: boolean;
  template_membership_months: number | null;
  template_duration_days: number | null;
  balances: EntitlementBalance[];
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const service = createServiceClient();

  // Step 1: collect band ids the user belongs to. Band-owned
  // entitlements are visible to every band member (per Cole's rule —
  // bands are a shared resource).
  const { data: memberships } = await service
    .from('band_members')
    .select('band_id')
    .eq('user_id', user.id);
  const bandIds = ((memberships ?? []) as Array<{ band_id: string }>).map((m) => m.band_id);

  // Step 2: fetch entitlements where user_id = me OR band_id IN (my bands).
  // We don't filter by status so customers can see their expired/exhausted
  // history too — UI sorts by status.
  let query = service
    .from('package_entitlements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  // Postgres OR-across-different-columns: use the .or() builder.
  if (bandIds.length > 0) {
    const bandList = bandIds.map((id) => `band_id.eq.${id}`).join(',');
    query = query.or(`user_id.eq.${user.id},${bandList}`);
  } else {
    query = query.eq('user_id', user.id);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('[packages/entitlements GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type EntRow = {
    id: string; template_id: string; user_id: string | null; band_id: string | null;
    status: 'active' | 'exhausted' | 'expired';
    payment_status: 'current' | 'past_due' | 'collections' | 'written_off';
    starts_at: string; ends_at: string;
    current_period_end: string | null;
    stripe_subscription_id: string | null;
  };
  const entRows = (rows ?? []) as EntRow[];

  if (entRows.length === 0) {
    return NextResponse.json({ entitlements: [] });
  }

  // Step 3: hydrate templates + balances + band names in batch.
  const entIds = entRows.map((e) => e.id);
  const tplIds = Array.from(new Set(entRows.map((e) => e.template_id)));
  const bandIdsForLookup = Array.from(
    new Set(entRows.map((e) => e.band_id).filter((b): b is string => !!b)),
  );

  const [{ data: balRows }, { data: tplRows }, { data: bandRows }] = await Promise.all([
    service
      .from('package_entitlement_balances')
      .select('*')
      .in('entitlement_id', entIds),
    service
      .from('package_templates')
      .select('id, name, description, is_membership, membership_months, duration_days')
      .in('id', tplIds),
    bandIdsForLookup.length
      ? service.from('bands').select('id, display_name').in('id', bandIdsForLookup)
      : Promise.resolve({ data: [] }),
  ]);

  type BalRow = EntitlementBalance & { entitlement_id: string };
  const balByEntitlement = new Map<string, EntitlementBalance[]>();
  for (const bal of (balRows ?? []) as BalRow[]) {
    const list = balByEntitlement.get(bal.entitlement_id) ?? [];
    list.push({
      id: bal.id,
      kind: bal.kind,
      media_offering_id: bal.media_offering_id,
      full_price_cents: bal.full_price_cents,
      package_value_cents: bal.package_value_cents,
      notes: bal.notes,
      quantity_granted: bal.quantity_granted,
      quantity_redeemed: bal.quantity_redeemed,
    });
    balByEntitlement.set(bal.entitlement_id, list);
  }

  type Tpl = { id: string; name: string; description: string | null; is_membership: boolean; membership_months: number | null; duration_days: number | null };
  const tplMap = new Map<string, Tpl>();
  for (const t of (tplRows ?? []) as Tpl[]) {
    tplMap.set(t.id, t);
  }

  type Band = { id: string; display_name: string };
  const bandMap = new Map<string, Band>();
  for (const b of (bandRows ?? []) as Band[]) {
    bandMap.set(b.id, b);
  }

  const entitlements: ActiveEntitlement[] = entRows.map((e) => {
    const tpl = tplMap.get(e.template_id);
    return {
      id: e.id,
      template_id: e.template_id,
      user_id: e.user_id,
      band_id: e.band_id,
      band_name: e.band_id ? (bandMap.get(e.band_id)?.display_name ?? null) : null,
      status: e.status,
      payment_status: e.payment_status,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      current_period_end: e.current_period_end,
      has_stripe_subscription: !!e.stripe_subscription_id,
      template_name: tpl?.name ?? '(deleted template)',
      template_description: tpl?.description ?? null,
      template_is_membership: tpl?.is_membership ?? false,
      template_membership_months: tpl?.membership_months ?? null,
      template_duration_days: tpl?.duration_days ?? null,
      balances: balByEntitlement.get(e.id) ?? [],
    };
  });

  return NextResponse.json({ entitlements });
}
