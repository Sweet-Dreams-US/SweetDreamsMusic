// GET /api/admin/rewards/overview — the all-users rewards view.
// Every owner (user or band) with reward grants, grouped, with status counts +
// what counters they've reached, plus a summary (pending count + est. exposure).
// Admin-only. This is Cole's control surface for the launch giveaway.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = createServiceClient();
  const [{ data: grants }, { data: profs }, { data: bands }] = await Promise.all([
    db.from('reward_grants').select('*').order('created_at', { ascending: false }),
    db.from('profiles').select('user_id,email,display_name'),
    db.from('bands').select('id,display_name'),
  ]);

  const profByUser = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));
  const bandById = new Map<string, any>((bands ?? []).map((b: any) => [b.id, b]));

  const owners = new Map<string, any>();
  for (const g of (grants ?? []) as any[]) {
    const key = g.owner_band_id ? `band:${g.owner_band_id}` : `user:${g.owner_user_id}`;
    if (!owners.has(key)) {
      const isBand = !!g.owner_band_id;
      const prof = isBand ? null : profByUser.get(g.owner_user_id);
      const band = isBand ? bandById.get(g.owner_band_id) : null;
      owners.set(key, {
        key, kind: isBand ? 'band' : 'user',
        id: g.owner_band_id || g.owner_user_id,
        name: isBand ? (band?.display_name || 'Band') : (prof?.display_name || prof?.email || 'User'),
        email: isBand ? null : (prof?.email || null),
        grants: [], counters: {} as Record<string, number>,
        pending: 0, issued: 0, approved: 0, denied: 0,
      });
    }
    const o = owners.get(key);
    o.grants.push({
      id: g.id, rule_key: g.rule_key, track: g.track, counter: g.counter, period_key: g.period_key,
      reward_type: g.reward_type, reward_value: g.reward_value, value_cents: g.value_cents,
      status: g.status, counter_value: g.counter_value, threshold: g.threshold,
      label: g.metadata?.label || g.rule_key, source: g.metadata?.source || null,
      issuance: g.issuance, expires_at: g.expires_at,
    });
    // "what they're at": highest counter snapshot we've seen per counter.
    o.counters[g.counter] = Math.max(o.counters[g.counter] || 0, Number(g.counter_value) || 0);
    if (g.status === 'pending_approval') o.pending++;
    else if (g.status === 'issued') o.issued++;
    else if (g.status === 'approved') o.approved++;
    else if (g.status === 'denied') o.denied++;
  }

  const all = (grants ?? []) as any[];
  const summary = {
    owners: owners.size,
    pending: all.filter((g) => g.status === 'pending_approval').length,
    approved: all.filter((g) => g.status === 'approved').length,
    issued: all.filter((g) => g.status === 'issued').length,
    pendingValueCents: all.filter((g) => g.status === 'pending_approval').reduce((s, g) => s + (Number(g.value_cents) || 0), 0),
  };

  return NextResponse.json({
    summary,
    owners: Array.from(owners.values()).sort((a, b) => b.pending - a.pending || b.grants.length - a.grants.length),
  });
}
