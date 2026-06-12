// app/api/cron/expire-entitlements/route.ts
//
// Daily cron that flips package entitlements past their `ends_at`
// from status='active' to status='expired'. Frozen unredeemed
// balances become studio's revenue (cash collected, value not
// delivered) — this is what the accounting tab will surface in a
// future round as "forfeit revenue."
//
// Also flips entitlements where every balance is fully redeemed
// from 'active' to 'exhausted' (a usability marker — customer can
// see they're at zero) — though entitlements stay valid until
// ends_at even when exhausted, in case admin issues an add-on.
//
// Auth: Bearer CRON_SECRET. Vercel cron sets this header
// automatically when invoking the path. Same pattern as every
// other cron in this project.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const nowISO = new Date().toISOString();

  // ── Pass 1: expire past-window entitlements ──────────────────────
  // active → expired when ends_at < now()
  const { data: expired, error: expireErr } = await supabase
    .from('package_entitlements')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('ends_at', nowISO)
    .select('id, user_id, band_id, ends_at');
  if (expireErr) {
    console.error('[cron/expire-entitlements] expire pass:', expireErr);
    return NextResponse.json({ error: expireErr.message }, { status: 500 });
  }
  const expiredCount = (expired ?? []).length;

  // ── Pass 2: mark exhausted entitlements ──────────────────────────
  // An entitlement is exhausted when EVERY balance has redeemed >=
  // granted. We do the check via SQL by counting balances where
  // remaining > 0 — when zero remain with anything left, mark
  // exhausted.
  //
  // Using a CTE so we can find candidates and update them in one
  // round-trip. Only flips active → exhausted (not expired entitlements
  // — those stay expired regardless of balance state).
  const { data: exhausted, error: exhaustedErr } = await supabase.rpc(
    'mark_exhausted_package_entitlements',
    {},
  );
  // The RPC may not exist yet — gracefully fall back to a SQL pass
  // via a regular query. Most projects don't have an RPC for this so
  // we'll do it client-side with a 2-query approach instead.
  if (exhaustedErr) {
    console.log('[cron/expire-entitlements] mark_exhausted RPC not present; using fallback');
  }

  // Fallback exhaustion pass: pull active entitlements, check balances
  // per-row, update those at zero remaining. Cheaper than RPC for
  // small counts. This is safe to run unconditionally even if the RPC
  // succeeded (it'll find zero candidates the second pass).
  const { data: activeCandidates } = await supabase
    .from('package_entitlements')
    .select('id')
    .eq('status', 'active');
  const candidateIds = ((activeCandidates ?? []) as Array<{ id: string }>).map((r) => r.id);

  let exhaustedCount = 0;
  if (candidateIds.length > 0) {
    const { data: balances } = await supabase
      .from('package_entitlement_balances')
      .select('entitlement_id, quantity_granted, quantity_redeemed')
      .in('entitlement_id', candidateIds);

    type Bal = { entitlement_id: string; quantity_granted: number; quantity_redeemed: number };
    const byEnt = new Map<string, Bal[]>();
    for (const b of (balances ?? []) as Bal[]) {
      const list = byEnt.get(b.entitlement_id) ?? [];
      list.push(b);
      byEnt.set(b.entitlement_id, list);
    }

    const exhaustedIds: string[] = [];
    for (const [entId, bals] of byEnt.entries()) {
      // Skip empty entitlements (no balances at all — likely a
      // deleted-template edge case). Don't mark them exhausted.
      if (bals.length === 0) continue;
      const allZero = bals.every((b) => b.quantity_redeemed >= b.quantity_granted);
      if (allZero) exhaustedIds.push(entId);
    }

    if (exhaustedIds.length > 0) {
      const { error: updErr } = await supabase
        .from('package_entitlements')
        .update({ status: 'exhausted' })
        .in('id', exhaustedIds);
      if (updErr) {
        console.error('[cron/expire-entitlements] exhausted update:', updErr);
      } else {
        exhaustedCount = exhaustedIds.length;
      }
    }
  }

  // Sanity: also include any results the RPC returned (if it exists
  // and ran successfully).
  const exhaustedCountTotal = exhaustedCount + (Array.isArray(exhausted) ? exhausted.length : 0);

  console.log(
    `[cron/expire-entitlements] expired=${expiredCount} exhausted=${exhaustedCountTotal}`,
  );

  return NextResponse.json({
    ok: true,
    expired: expiredCount,
    exhausted: exhaustedCountTotal,
  });
}
