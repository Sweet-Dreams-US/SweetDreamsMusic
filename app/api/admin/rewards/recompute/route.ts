// POST /api/admin/rewards/recompute — seed the rules + run the customer/band
// backfill. Body: { apply?: boolean } (default dry run — reads only, writes
// nothing). Apply seeds reward_rules and writes the backfill grants (free work
// lands pending_approval; spend tiers land approved). Admin-only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { seedRewardRules, backfillCustomersAndBands } from '@/lib/rewards-server';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* default dry run */ }
  const apply = body.apply === true;
  // Progress-only by default (baseline already-reached tiers, don't re-gift). Pass
  // baseline:false only for a post-launch sweep that should queue NEW tiers pending.
  const baseline = body.baseline !== false;

  const db = createServiceClient();
  try {
    let seeded = 0;
    if (apply) seeded = (await seedRewardRules(db)).upserted;
    const report = await backfillCustomersAndBands(db, new Date(), { dryRun: !apply, baseline });
    return NextResponse.json({ success: true, apply, baseline, seeded, report });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
