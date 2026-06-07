import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { backfillCustomersAndBands, sweepStaffBonuses } from '@/lib/rewards-server';

export const maxDuration = 60;

/**
 * Vercel Cron — the going-forward rewards sweep. THE master switch is
 * reward_settings.active: this no-ops unless active=true, so rewards stay fully
 * dormant until an admin turns them on (after running the one-time baseline
 * backfill, which records everyone's CURRENT tier so nothing is gifted
 * retroactively).
 *
 * When active, it sweeps customers/bands (baseline:false → newly-crossed tiers:
 * free work + beat/spend discounts; free work lands pending_approval for the
 * admin, discounts auto-approve) + staff cash-bonus sweeps. Idempotent per
 * (rule, window) — safe to run daily; a tier already granted this window won't
 * re-grant.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: settings } = await db.from('reward_settings').select('active').is('studio_id', null).maybeSingle();
  if (!settings?.active) {
    return NextResponse.json({ skipped: true, reason: 'rewards not active (reward_settings.active=false)' });
  }

  try {
    const now = new Date();
    const report = await backfillCustomersAndBands(db, now, { dryRun: false, baseline: false });
    const staffReport = await sweepStaffBonuses(db, now, { dryRun: false });
    console.log('[cron/rewards-recompute]', JSON.stringify({ report, staffReport }));
    return NextResponse.json({ success: true, report, staffReport });
  } catch (e: unknown) {
    console.error('[cron/rewards-recompute] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
