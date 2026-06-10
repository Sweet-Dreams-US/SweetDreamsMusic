import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { materializeRecurringExpenses } from '@/lib/tax-recurring-server';

export const maxDuration = 60;

// Vercel Cron — materializes recurring expense templates (monthly rent, subs)
// into business_expenses on/after each template's day-of-month. Runs daily;
// idempotent per template per month via last_materialized_period.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await materializeRecurringExpenses(createServiceClient());
    console.log('[cron/recurring-expenses]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    console.error('[cron/recurring-expenses] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
