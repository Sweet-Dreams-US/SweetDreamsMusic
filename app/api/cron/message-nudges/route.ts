import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sweepUnreadNudges } from '@/lib/messaging-server';
import { sendUnreadMessageNudge } from '@/lib/email';

export const maxDuration = 60;

// Vercel Cron — unread-message email nudges (Plan 4 §4). A chat message that
// sits unread for 24h earns ONE email per thread per unread burst (last_nudge_at
// dedup — never re-nudged until a newer message arrives). System mirrors are
// skipped (those already emailed). Studio threads nudge only the artist.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = createServiceClient();
    const result = await sweepUnreadNudges(db, (to, details) => sendUnreadMessageNudge(to, details));
    console.log('[cron/message-nudges]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    console.error('[cron/message-nudges] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
