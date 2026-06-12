import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getClientKey, markOnce } from '@/lib/rate-limit';

/**
 * POST /api/beats/track-play — record a play for a beat preview.
 *
 * Two layers of abuse protection:
 *   1. Middleware rate-limits this path to 20 requests/min/IP.
 *   2. This handler dedups (ip, beatId, minute) so a script firing 20 times/min
 *      at the same beat still only credits ONE play. The first layer caps
 *      total volume; this layer prevents one attacker from cheaply inflating
 *      one beat's popularity metric.
 *
 * If Supabase env vars are missing or the RPC errors, markOnce fails open
 * (returns true) — no dedup, but also no false negatives that would block
 * legitimate plays.
 */
export async function POST(request: NextRequest) {
  try {
    const { beatId } = await request.json();
    if (!beatId || typeof beatId !== 'string') {
      return NextResponse.json({ error: 'beatId required' }, { status: 400 });
    }

    // Per-minute bucket key — floor(now / 60_000) gives a minute-aligned
    // integer. Combined with ip+beatId, same client playing same beat within
    // the same wall-clock minute = one key.
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const dedupKey = `rl:play:dedup:${getClientKey(request)}:${beatId}:${minuteBucket}`;
    const isFirst = await markOnce(dedupKey, 90); // 90s ttl > 60s window
    if (!isFirst) {
      // Still return success so the client doesn't retry — it IS a successful
      // play from the user's perspective, we just don't count it twice.
      return NextResponse.json({ success: true, deduped: true });
    }

    const supabase = createServiceClient();
    await supabase.rpc('increment_play_count', { p_beat_id: beatId });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to track play' }, { status: 500 });
  }
}
