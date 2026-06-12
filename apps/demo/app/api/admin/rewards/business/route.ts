// GET /api/admin/rewards/business — the rewards BUSINESS view (Cole's ask):
// how much free have we given out, what's outstanding, and are rewards driving
// revenue? Sourced from reward_grants (the reliable record of what was given) +
// a revenue correlation between reward recipients and all customers. Admin-only.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { estimateExposureCents } from '@/lib/rewards-server';
import { ENGINEER_SESSION_SPLIT, MEDIA_WORKER_TOTAL } from '@/lib/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */

// What a reward actually COSTS the studio (cash out the door), vs its retail value:
//  • free studio hours → the engineer's pay on that work (60%)
//  • free media (video/photo/cutdown) → the media team's pay on it (50%)
//  • cash bonus / account credit → the full amount
//  • discounts/status → a margin reduction realized at booking, not a cash outlay here (0)
function actualCostCents(reward_type: string, retailCents: number, valueCents: number): number {
  switch (reward_type) {
    case 'free_hours': return Math.round(retailCents * ENGINEER_SESSION_SPLIT);
    case 'free_short_video': case 'free_music_video': case 'free_photo_session':
    case 'free_cutdowns': case 'bundled_cutdowns': return Math.round(retailCents * MEDIA_WORKER_TOTAL);
    case 'cash_bonus': case 'account_credit_cents': return valueCents;
    default: return 0;
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = createServiceClient();
  const { data: grants } = await db.from('reward_grants')
    .select('owner_user_id, reward_type, reward_value, value_cents, status, expires_at');

  const all = (grants ?? []) as any[];
  const now = Date.now();

  // ── Given out / outstanding (retail value via the shared estimator) ──
  const byType: Record<string, { count: number; retailCents: number; actualCostCents: number }> = {};
  const byStatus: Record<string, number> = {};
  let givenRetail = 0, outstandingRetail = 0, redeemedRetail = 0, totalActualCost = 0;
  // "Given" = anything the customer actually got or can use (issued/redeemed/approved).
  // baseline/denied/pending are excluded from the give-away total.
  const GIVEN = new Set(['issued', 'redeemed', 'approved']);
  for (const g of all) {
    byStatus[g.status] = (byStatus[g.status] || 0) + 1;
    const retail = estimateExposureCents({ reward_type: g.reward_type, reward_value: Number(g.reward_value) || 0, value_cents: Number(g.value_cents) || 0 });
    const cost = actualCostCents(g.reward_type, retail, Number(g.value_cents) || 0);
    if (GIVEN.has(g.status)) {
      const b = (byType[g.reward_type] ??= { count: 0, retailCents: 0, actualCostCents: 0 });
      b.count++; b.retailCents += retail; b.actualCostCents += cost;
      givenRetail += retail; totalActualCost += cost;
      if (g.status === 'redeemed') redeemedRetail += retail;
      // Outstanding = issued/approved, not yet redeemed, not expired.
      if (g.status !== 'redeemed' && (!g.expires_at || new Date(g.expires_at).getTime() > now)) outstandingRetail += retail;
    }
  }

  // ── ROI: do reward recipients spend more? ──
  const recipientUserIds = Array.from(new Set(all.filter((g) => GIVEN.has(g.status) && g.owner_user_id).map((g) => g.owner_user_id)));
  // Map recipient user_ids -> emails (bookings are keyed by email).
  let recipientEmails = new Set<string>();
  if (recipientUserIds.length) {
    const { data: profs } = await db.from('profiles').select('user_id,email').in('user_id', recipientUserIds);
    recipientEmails = new Set((profs ?? []).map((p: any) => String(p.email || '').toLowerCase()).filter(Boolean));
  }

  // All completed studio revenue, bucketed by customer email.
  const { data: bk } = await db.from('bookings')
    .select('customer_email,total_amount')
    .eq('status', 'completed').is('deleted_at', null).gt('total_amount', 0);
  const spendByEmail = new Map<string, number>();
  for (const b of (bk ?? []) as any[]) {
    const e = String(b.customer_email || '').toLowerCase();
    if (!e) continue;
    spendByEmail.set(e, (spendByEmail.get(e) || 0) + (Number(b.total_amount) || 0));
  }
  let recipientSpend = 0, recipientCount = 0, otherSpend = 0, otherCount = 0;
  for (const [email, spend] of spendByEmail) {
    if (recipientEmails.has(email)) { recipientSpend += spend; recipientCount++; }
    else { otherSpend += spend; otherCount++; }
  }
  const recipientAvg = recipientCount ? Math.round(recipientSpend / recipientCount) : 0;
  const otherAvg = otherCount ? Math.round(otherSpend / otherCount) : 0;
  const liftPct = otherAvg ? Math.round(((recipientAvg - otherAvg) / otherAvg) * 100) : 0;

  return NextResponse.json({
    givenOut: { byType, totalRetailCents: givenRetail, totalActualCostCents: totalActualCost, redeemedRetailCents: redeemedRetail, outstandingRetailCents: outstandingRetail },
    byStatus,
    roi: {
      recipients: recipientCount, recipientSpendCents: recipientSpend, recipientAvgCents: recipientAvg,
      otherCustomers: otherCount, otherSpendCents: otherSpend, otherAvgCents: otherAvg,
      liftPct, // % more (or less) that reward recipients spend on average vs everyone else
    },
    note: 'Retail value = what the customer received free. Actual cash cost ≈ staff pay on redeemed comps. ROI compares avg completed-studio spend of reward recipients vs other customers.',
  });
}
