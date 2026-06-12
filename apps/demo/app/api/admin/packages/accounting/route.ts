// app/api/admin/packages/accounting/route.ts
//
// GET — accounting summary for the packages & memberships system.
// Surfaces the data Cole asked for at the start: "track every dollar."
//
// Returns:
//   • active_memberships_count + total monthly recurring (MRR-like)
//   • active_oneoffs_count + cash collected
//   • total_discount_absorbed_cents — sum across active entitlements,
//     i.e. the dollar value of margin sacrificed to win these deals
//   • unredeemed_liability_cents — value of pieces customers paid for
//     but haven't redeemed yet (studio "owes" them this work)
//   • forfeit_revenue_cents — cash collected for expired entitlements
//     where pieces went unredeemed (pure margin to studio)
//   • redemption_breakdown_cents — split by line kind, showing how
//     customers actually use what they buy
//
// Admin-only.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const service = createServiceClient();

  // ── Pull entitlements + their related quotes + balances ───────────
  // We work entirely off entitlements (the post-payment artifact) so
  // we never count un-paid quotes as revenue.
  const { data: entRows, error: entErr } = await service
    .from('package_entitlements')
    .select(`
      id, status, payment_status, starts_at, ends_at, stripe_subscription_id,
      template_id, quote_id
    `);
  if (entErr) {
    return NextResponse.json({ error: entErr.message }, { status: 500 });
  }
  type Ent = {
    id: string;
    status: 'active' | 'exhausted' | 'expired';
    payment_status: 'current' | 'past_due' | 'collections' | 'written_off';
    starts_at: string;
    ends_at: string;
    stripe_subscription_id: string | null;
    template_id: string;
    quote_id: string;
  };
  const ents = (entRows ?? []) as Ent[];

  if (ents.length === 0) {
    return NextResponse.json({
      active_memberships_count: 0,
      active_oneoffs_count: 0,
      monthly_recurring_revenue_cents: 0,
      oneoff_cash_collected_cents: 0,
      total_discount_absorbed_cents: 0,
      unredeemed_liability_cents: 0,
      forfeit_revenue_cents: 0,
      redemption_breakdown_cents: { studio_hours: 0, media_offering: 0, beat_credit: 0, custom: 0 },
      payment_status_breakdown: { current: 0, past_due: 0, collections: 0, written_off: 0 },
    });
  }

  // Hydrate templates + quotes + balances in batch.
  const tplIds = Array.from(new Set(ents.map((e) => e.template_id)));
  const quoteIds = Array.from(new Set(ents.map((e) => e.quote_id)));
  const entIds = ents.map((e) => e.id);

  const [{ data: tplRows }, { data: quoteRows }, { data: balRows }] = await Promise.all([
    service
      .from('package_templates')
      .select('id, is_membership, membership_months, price_cents')
      .in('id', tplIds),
    service
      .from('package_quotes')
      .select('id, total_price_cents, total_full_price_cents, total_discount_cents')
      .in('id', quoteIds),
    service
      .from('package_entitlement_balances')
      .select('entitlement_id, kind, full_price_cents, package_value_cents, quantity_granted, quantity_redeemed'),
  ]);

  type Tpl = { id: string; is_membership: boolean; membership_months: number | null; price_cents: number };
  const tplMap = new Map<string, Tpl>();
  for (const t of (tplRows ?? []) as Tpl[]) tplMap.set(t.id, t);

  type Quote = { id: string; total_price_cents: number; total_full_price_cents: number; total_discount_cents: number };
  const quoteMap = new Map<string, Quote>();
  for (const q of (quoteRows ?? []) as Quote[]) quoteMap.set(q.id, q);

  type Bal = {
    entitlement_id: string;
    kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
    full_price_cents: number;
    package_value_cents: number;
    quantity_granted: number;
    quantity_redeemed: number;
  };
  const balsByEnt = new Map<string, Bal[]>();
  // Filter out the rows we don't have entitlement_id for (defensive).
  const allBals = (balRows ?? []) as Bal[];
  for (const b of allBals) {
    const list = balsByEnt.get(b.entitlement_id) ?? [];
    list.push(b);
    balsByEnt.set(b.entitlement_id, list);
  }

  // ── Aggregate ────────────────────────────────────────────────────
  let activeMembershipsCount = 0;
  let activeOneoffsCount = 0;
  let monthlyRecurringRevenueCents = 0;
  let oneoffCashCollectedCents = 0;
  let totalDiscountAbsorbedCents = 0;
  let unredeemedLiabilityCents = 0;
  let forfeitRevenueCents = 0;
  const redemptionBreakdown: Record<Bal['kind'], number> = {
    studio_hours: 0,
    media_offering: 0,
    beat_credit: 0,
    custom: 0,
  };
  const paymentStatusBreakdown: Record<Ent['payment_status'], number> = {
    current: 0,
    past_due: 0,
    collections: 0,
    written_off: 0,
  };

  for (const ent of ents) {
    const tpl = tplMap.get(ent.template_id);
    const quote = quoteMap.get(ent.quote_id);
    const bals = balsByEnt.get(ent.id) ?? [];

    paymentStatusBreakdown[ent.payment_status]++;

    if (tpl?.is_membership) {
      if (ent.status === 'active') {
        activeMembershipsCount++;
        monthlyRecurringRevenueCents += tpl.price_cents;
      }
    } else {
      if (ent.status === 'active') {
        activeOneoffsCount++;
      }
      // For one-offs we count cash regardless of status (it was paid).
      if (quote) oneoffCashCollectedCents += quote.total_price_cents;
    }

    // Discount absorbed (active entitlements only — for expired ones,
    // the customer has already received whatever value they took, so
    // the "discount" is realized rather than ongoing).
    if (ent.status === 'active' && quote) {
      totalDiscountAbsorbedCents += quote.total_discount_cents;
    }

    // Tally redeemed value per kind. Use full_price_cents per unit so
    // the dashboard reflects retail-equivalent value delivered.
    for (const bal of bals) {
      if (bal.quantity_granted === 0) continue;
      const perUnitFull = bal.full_price_cents / bal.quantity_granted;
      const perUnitPkg = bal.package_value_cents / bal.quantity_granted;
      const remaining = bal.quantity_granted - bal.quantity_redeemed;

      // Redemption value (what was actually delivered, at retail):
      redemptionBreakdown[bal.kind] += Math.round(perUnitFull * bal.quantity_redeemed);

      if (ent.status === 'active') {
        // Customer still has these to redeem; we owe them this much
        // value (at the package rate, not retail — that's the deal).
        unredeemedLiabilityCents += Math.round(perUnitPkg * remaining);
      } else if (ent.status === 'expired') {
        // Forfeit: paid for, never redeemed, time's up.
        // Use package_value_cents (what they paid for it inside the
        // package), not retail.
        forfeitRevenueCents += Math.round(perUnitPkg * remaining);
      }
      // 'exhausted' has no remaining anyway.
    }
  }

  return NextResponse.json({
    active_memberships_count: activeMembershipsCount,
    active_oneoffs_count: activeOneoffsCount,
    monthly_recurring_revenue_cents: monthlyRecurringRevenueCents,
    oneoff_cash_collected_cents: oneoffCashCollectedCents,
    total_discount_absorbed_cents: totalDiscountAbsorbedCents,
    unredeemed_liability_cents: unredeemedLiabilityCents,
    forfeit_revenue_cents: forfeitRevenueCents,
    redemption_breakdown_cents: redemptionBreakdown,
    payment_status_breakdown: paymentStatusBreakdown,
  });
}
