import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sweepTaxReminders } from '@/lib/tax-reminders-server';
import { mirrorToThread } from '@/lib/messaging-mirror';
import { sendTaxEstimateReminder } from '@/lib/email';
import { formatCents } from '@/lib/utils';

export const maxDuration = 60;

// Vercel Cron — quarterly estimated-tax reminders (Plan 5 Phase 4). Fires 30 and
// 7 days before each due date, into each admin's studio thread + email. DORMANT
// until the year's tax_constants.reviewed = true (drafts never reach a studio).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const db = createServiceClient();
    const result = await sweepTaxReminders(db, async ({ adminEmails, quarter, dueDate, amountCents, daysOut }) => {
      const body = `Estimated tax reminder: your Q${quarter} federal payment is due ${dueDate} (${daysOut} days). Based on your year-to-date profit, set aside about ${formatCents(amountCents)}. Preparation and organization, not tax advice — review with your accountant.`;
      // In-app: into each admin's own studio thread.
      for (const email of adminEmails) {
        await mirrorToThread({ userEmail: email, kind: 'update', subject: `Q${quarter} estimated tax due ${dueDate}`, body });
      }
      // Email mirror.
      await sendTaxEstimateReminder(adminEmails, { quarter, dueDate, amountCents, daysOut });
    });
    console.log('[cron/tax-reminders]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    console.error('[cron/tax-reminders] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
