// GET /api/admin/rewards/standings — the combined "standings + approvals" control
// surface (replaces the old all-users grant list). Per user type: every owner ranked
// by progression toward their next reward. Plus the pending-approval queue (what to
// approve, like session requests). Admin-only, read-only — viewing gifts nothing.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { REWARD_RULES, type RewardRule } from '@/lib/rewards';
import {
  customerProgress, bandProgress, engineerProgress,
  producerProgress, mediaManagerProgress, getLaunchDate,
} from '@/lib/rewards-server';
import { loadEngineers } from '@/lib/engineers-server';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fmtUsd = (cents: number) => `$${Math.round((Number(cents) || 0) / 100).toLocaleString('en-US')}`;
const round1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
const rewardOf = (label: string) => { const i = label.indexOf('→'); return i >= 0 ? label.slice(i + 1).trim() : label; };

function tierProgress(rules: RewardRule[], value: number) {
  const sorted = rules.filter((r) => r.threshold > 0).sort((a, b) => a.threshold - b.threshold);
  const reached = sorted.filter((t) => value >= t.threshold).length;
  const next = sorted.find((t) => value < t.threshold);
  return {
    reached, total: sorted.length,
    next: next ? {
      reward: rewardOf(next.label),
      threshold: next.threshold,
      remaining: Math.max(0, Math.round((next.threshold - value) * 10) / 10),
      pct: next.threshold > 0 ? Math.min(100, Math.round((value / next.threshold) * 100)) : 0,
    } : null,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const db = createServiceClient();
  const now = new Date();
  const launchDate = await getLaunchDate(db);

  const [{ data: grants }, { data: profs }, { data: bands }] = await Promise.all([
    db.from('reward_grants').select('*').order('created_at', { ascending: false }),
    db.from('profiles').select('id,user_id,email,display_name,producer_name,is_producer'),
    db.from('bands').select('id,display_name'),
  ]);
  const profByUser = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));
  const profById = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]));
  const bandById = new Map<string, any>((bands ?? []).map((b: any) => [b.id, b]));

  // Per-owner grant badges + the pending-approval queue.
  const badge = new Map<string, { pending: number; issued: number; baseline: number }>();
  const bump = (k: string, s: string) => {
    const b = badge.get(k) ?? badge.set(k, { pending: 0, issued: 0, baseline: 0 }).get(k)!;
    if (s === 'pending_approval') b.pending++;
    else if (s === 'issued' || s === 'approved' || s === 'redeemed') b.issued++;
    else if (s === 'baseline') b.baseline++;
  };
  const pendingQueue: any[] = [];
  for (const g of (grants ?? []) as any[]) {
    const ownerKey = g.owner_band_id ? `band:${g.owner_band_id}` : `user:${g.owner_user_id}`;
    bump(ownerKey, g.status);
    if (g.status === 'pending_approval') {
      const isBand = !!g.owner_band_id;
      const nm = isBand
        ? (bandById.get(g.owner_band_id)?.display_name || 'Band')
        : (profByUser.get(g.owner_user_id)?.display_name || profByUser.get(g.owner_user_id)?.email || 'User');
      pendingQueue.push({
        id: g.id, ownerName: nm, ownerKind: isBand ? 'band' : 'user', track: g.track,
        rewardLabel: g.metadata?.label ? rewardOf(g.metadata.label) : g.reward_type,
        reward_type: g.reward_type, reward_value: g.reward_value, value_cents: g.value_cents,
        counter: g.counter, counter_value: g.counter_value, threshold: g.threshold,
        source: g.metadata?.source || null,
      });
    }
  }

  const all = (grants ?? []) as any[];
  const summary = {
    owners: new Set(all.map((g) => (g.owner_band_id ? `b:${g.owner_band_id}` : `u:${g.owner_user_id}`))).size,
    pending: all.filter((g) => g.status === 'pending_approval').length,
    issued: all.filter((g) => ['issued', 'approved', 'redeemed'].includes(g.status)).length,
    baseline: all.filter((g) => g.status === 'baseline').length,
    pendingValueCents: all.filter((g) => g.status === 'pending_approval').reduce((s, g) => s + (Number(g.value_cents) || 0), 0),
  };

  // Rule subsets per track / primary counter.
  const custStudio = REWARD_RULES.filter((r) => r.track === 'customer' && r.counter === 'studio_hours');
  const bandHours = REWARD_RULES.filter((r) => r.track === 'band' && r.counter === 'band_hours');
  const engMonthly = REWARD_RULES.filter((r) => r.track === 'engineer' && r.window === 'monthly');
  const prodRules = REWARD_RULES.filter((r) => r.track === 'producer');
  const mediaRules = REWARD_RULES.filter((r) => r.track === 'media_manager');

  // ── Customers: booking customers ∪ beat buyers ──
  const [{ data: bookingRows }, { data: beatBuyers }, { data: mediaNames }] = await Promise.all([
    db.from('bookings').select('customer_email').eq('status', 'completed').is('deleted_at', null).is('band_id', null).gt('total_amount', 0),
    db.from('beat_purchases').select('buyer_id').not('buyer_id', 'is', null),
    db.from('media_sales').select('filmed_by,edited_by'),
  ]);
  const emailToUser = new Map<string, string>();
  for (const p of (profs ?? []) as any[]) if (p.email && p.user_id) emailToUser.set(String(p.email).toLowerCase(), p.user_id);
  const custUserIds = new Set<string>();
  for (const b of (bookingRows ?? []) as any[]) { const uid = emailToUser.get(String(b.customer_email || '').toLowerCase()); if (uid) custUserIds.add(uid); }
  for (const b of (beatBuyers ?? []) as any[]) if (b.buyer_id) custUserIds.add(b.buyer_id);

  const customerRows = (await Promise.all(Array.from(custUserIds).map(async (uid) => {
    const p = profByUser.get(uid);
    if (!p) return null;
    const prog = await customerProgress(db, uid, p.email || '', now);
    const b = badge.get(`user:${uid}`) ?? { pending: 0, issued: 0, baseline: 0 };
    return {
      id: uid, name: p.display_name || p.email || 'Customer', sub: p.email || null, kind: 'user',
      primaryDisplay: String(round1(prog.studio_hours)), primaryUnit: 'studio hrs', rank: prog.studio_hours,
      extras: [{ label: 'spent', value: fmtUsd(prog.dollars_spent) }, { label: 'beats', value: fmtUsd(prog.beat_spend) }],
      ...tierProgress(custStudio, prog.studio_hours), ...b,
    };
  }))).filter(Boolean);

  // ── Bands ──
  const bandRows = await Promise.all((bands ?? []).map(async (bd: any) => {
    const prog = await bandProgress(db, bd.id, now);
    const b = badge.get(`band:${bd.id}`) ?? { pending: 0, issued: 0, baseline: 0 };
    return {
      id: bd.id, name: bd.display_name || 'Band', sub: null, kind: 'band',
      primaryDisplay: String(round1(prog.band_hours)), primaryUnit: 'band hrs', rank: prog.band_hours,
      extras: [{ label: 'spent', value: fmtUsd(prog.band_spend) }],
      ...tierProgress(bandHours, prog.band_hours), ...b,
    };
  }));

  // ── Engineers (monthly hours run; quarter shown as extra) ──
  const roster = await loadEngineers(db, { activeOnly: true });
  const engineerRows = await Promise.all(roster.map(async (e) => {
    const prog = await engineerProgress(db, e.name, now, launchDate);
    return {
      id: e.id, name: e.displayName || e.name, sub: 'this month', kind: 'engineer',
      primaryDisplay: String(round1(prog.monthHours)), primaryUnit: 'hrs/mo', rank: prog.monthHours,
      extras: [{ label: 'quarter', value: `${round1(prog.quarterHours)} hrs` }],
      ...tierProgress(engMonthly, prog.monthHours), pending: 0, issued: 0, baseline: 0,
    };
  }));

  // ── Producers (beat revenue this year). producer_id = profiles.id. ──
  const { data: beatPosters } = await db.from('beats').select('producer_id').not('producer_id', 'is', null);
  const prodSet = new Map<string, any>();
  for (const p of (profs ?? []) as any[]) if (p.is_producer || p.producer_name) prodSet.set(p.id, p);
  for (const r of (beatPosters ?? []) as any[]) { const p = profById.get(r.producer_id); if (p) prodSet.set(p.id, p); }
  const producerRows = await Promise.all(Array.from(prodSet.values()).map(async (p: any) => {
    const rev = await producerProgress(db, p.id, now);
    return {
      id: p.id, name: p.producer_name || p.display_name || p.email || 'Producer', sub: 'beat sales / yr', kind: 'producer',
      primaryDisplay: fmtUsd(rev), primaryUnit: '', rank: rev,
      extras: [], ...tierProgress(prodRules, rev), pending: 0, issued: 0, baseline: 0,
    };
  }));

  // ── Media workers (film+edit revenue this year). Free-text names. ──
  const workerNames = Array.from(new Set(
    (mediaNames ?? []).flatMap((m: any) => [m.filmed_by, m.edited_by]).filter((n: any) => n && String(n).trim()),
  )) as string[];
  const mediaRows = await Promise.all(workerNames.map(async (nm) => {
    const rev = await mediaManagerProgress(db, nm, now);
    return {
      id: nm, name: nm, sub: 'media delivered / yr', kind: 'media_manager',
      primaryDisplay: fmtUsd(rev), primaryUnit: '', rank: rev,
      extras: [], ...tierProgress(mediaRules, rev), pending: 0, issued: 0, baseline: 0,
    };
  }));

  const byRank = (a: any, b: any) => b.rank - a.rank;
  const tracks = [
    { key: 'customer', label: 'Customers', rows: customerRows.sort(byRank) },
    { key: 'band', label: 'Bands', rows: bandRows.sort(byRank) },
    { key: 'engineer', label: 'Engineers', rows: engineerRows.sort(byRank) },
    { key: 'producer', label: 'Producers', rows: producerRows.sort(byRank) },
    { key: 'media_manager', label: 'Media', rows: mediaRows.sort(byRank) },
  ].filter((t) => t.rows.length > 0);

  return NextResponse.json({ summary, pendingQueue, tracks });
}
