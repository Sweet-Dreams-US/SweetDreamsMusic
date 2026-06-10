// GET /api/admin/tax/estimates?year= — quarterly estimate set-asides + due
// dates + the entity-type guidance copy. Admin only. Snapshots the current
// quarter into tax_estimate_snapshots (idempotent per year/quarter) so history
// is preserved. Returns reviewed=false until a CPA signs off tax_constants.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { computeEstimates, getTaxProfile } from '@/lib/tax-server';
import { ENTITY_TYPES, quarterOfMonth, entityOwesSeTax } from '@/lib/tax';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getUTCFullYear();
  const db = createServiceClient();
  const [est, profile] = await Promise.all([computeEstimates(db, year), getTaxProfile(db)]);
  if (!est) {
    return NextResponse.json({
      year, available: false,
      message: `No tax figures are configured for ${year} yet. Your accountant reviews these before they appear.`,
    });
  }

  // Snapshot the current quarter for the historical record (idempotent upsert).
  const nowMonth = new Date().getUTCMonth() + 1;
  const curQ = quarterOfMonth(nowMonth);
  const cur = est.quarters.find((q) => q.quarter === curQ);
  if (cur && new Date().getUTCFullYear() === year) {
    try {
      // MERGE assumptions — the reminder cron stores its dedup array in there;
      // a wholesale replace would wipe it and re-fire reminders (audit finding).
      const { data: existing } = await db.from('tax_estimate_snapshots')
        .select('assumptions').eq('tax_year', year).eq('quarter', curQ).is('studio_id', null).maybeSingle();
      await db.from('tax_estimate_snapshots').upsert({
        studio_id: null, tax_year: year, quarter: curQ,
        ytd_net_cents: cur.ytdNetCents, se_tax_cents: cur.seTaxCents,
        income_tax_cents: cur.incomeTaxCents, suggested_payment_cents: cur.suggestedPaymentCents,
        assumptions: {
          ...(((existing as { assumptions?: Record<string, unknown> })?.assumptions) ?? {}),
          entity_type: est.entityType, income_rate_pct: profile.estimatedIncomeTaxRatePct, reviewed: est.reviewed,
        },
        computed_at: new Date().toISOString(),
      } as never, { onConflict: 'studio_id,tax_year,quarter' });
    } catch { /* snapshotting is best-effort — never block the read */ }
  }

  const entityNote = ENTITY_TYPES.find((e) => e.value === est.entityType)?.note ?? '';
  return NextResponse.json({
    year, available: true, reviewed: est.reviewed,
    entityType: est.entityType, entityNote, owesSeTax: entityOwesSeTax(est.entityType),
    currentQuarter: curQ, quarters: est.quarters,
  });
}
