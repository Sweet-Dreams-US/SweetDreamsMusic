import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { syncMetaLeads, PageAccessError } from '@/lib/meta-leads';

export const maxDuration = 60;

/**
 * Vercel Cron — hourly Meta lead-ads sync (vercel.json: 20 * * * *).
 *
 * Pulls new lead-form submissions into meta_leads so ad leads reach the
 * Marketing tab without anyone pressing Sync, and so the studio keeps leads
 * past Meta's ~90-day retention. Idempotent (upsert on leadgen_id).
 *
 * Until the Sweet Dreams Page is assigned to the system user, this reports
 * skipped (not an error) — no alert spam for a known setup state.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  try {
    const report = await syncMetaLeads(db);
    console.log('[cron/sync-meta-leads]', JSON.stringify(report));
    return NextResponse.json({ success: true, ...report });
  } catch (e) {
    if (e instanceof PageAccessError) {
      console.warn('[cron/sync-meta-leads] page not assigned yet — skipping');
      return NextResponse.json({ skipped: true, reason: 'page not assigned to system user' });
    }
    console.error('[cron/sync-meta-leads] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
