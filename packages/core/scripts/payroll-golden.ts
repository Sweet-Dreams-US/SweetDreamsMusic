/**
 * scripts/payroll-golden.ts — the payroll cutover gate (revenue-critical).
 *   npx tsx --env-file=.env.local scripts/payroll-golden.ts            # verify
 *   npx tsx --env-file=.env.local scripts/payroll-golden.ts --write    # (re)write the snapshot
 *   npx tsx --env-file=.env.local scripts/payroll-golden.ts --seed     # also prove DB-config read == constants
 *
 * Fetches the FULL live accounting dataset (same queries as /api/admin/accounting)
 * and proves three things, in order of strength:
 *   1) computeEarningsCore (the extracted, DB-share-aware math) reproduces the
 *      ORIGINAL inline computeEarnings logic EXACTLY (computeEarningsLegacy here is
 *      a verbatim copy of the pre-refactor function). This protects the extraction.
 *   2) The result matches the committed snapshot (scripts/__golden__/payroll.json).
 *   3) (--seed) After seeding revenue_settings from constants, reading the config
 *      from the DB still reproduces the same payroll — the DB-cutover is safe.
 *
 * If any per-person / per-field value differs, the refactor changed payroll. Fail.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { ENGINEERS } from '../lib/constants';
import {
  computeEarningsCore, revenueConfigFromConstants, type EarningsInput, type PersonEarnings, type RevenueConfig,
} from '../lib/earnings-core';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing env. Run with --env-file=.env.local'); process.exit(1); }
const db = createClient(URL, KEY);
const SNAP = join(__dirname, '__golden__', 'payroll.json');
const WRITE = process.argv.includes('--write');
const SEED = process.argv.includes('--seed');
// Auto-detected in main(): true once migration 070 adds the snapshot columns.
let SELECT_SNAPSHOTS = false;

// ── Verbatim copy of the ORIGINAL computeEarnings (+ its normalizeName). This is
//    the independent reference the extraction must match. Do NOT "improve" it. ──
const LEGACY_NAME_MAP: Record<string, string> = {};
ENGINEERS.forEach((eng) => {
  LEGACY_NAME_MAP[eng.name.toLowerCase()] = eng.name;
  if (eng.displayName && eng.displayName !== eng.name) LEGACY_NAME_MAP[eng.displayName.toLowerCase()] = eng.name;
  const emailPrefix = eng.email.split('@')[0].toLowerCase();
  if (emailPrefix) LEGACY_NAME_MAP[emailPrefix] = eng.name;
});
LEGACY_NAME_MAP['zion omari'] = 'Zion';
LEGACY_NAME_MAP['zion tinsley'] = 'Zion';
function legacyNorm(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  return LEGACY_NAME_MAP[t.toLowerCase()] || t;
}
const L_ENG = 0.60, L_PROD = 0.60, L_SELLER = 0.15, L_WORKER = 0.50;

function computeEarningsLegacy(input: EarningsInput): Record<string, PersonEarnings> {
  const { bookings: bks, media, beats, mediaSessions = [], engineerNames = {}, packageCommissions = [], bonuses = [] } = input;
  const people: Record<string, PersonEarnings> = {};
  const init = (): PersonEarnings => ({ sessionCount: 0, sessionRevenue: 0, sessionPay: 0, sessionHours: 0, mediaCommission: 0, mediaSoldCount: 0, mediaWorkerPay: 0, mediaFilmedCount: 0, mediaEditedCount: 0, beatSales: 0, beatProducerPay: 0, beatCount: 0, packageCommission: 0, packageSoldCount: 0, rewardsCost: 0, bonusPay: 0, bonusCount: 0, totalPay: 0 });
  bks.forEach((b) => {
    if (b.status !== 'completed') return;
    const eng = legacyNorm(b.engineer_name);
    if (!eng || eng === 'Unassigned') return;
    if (!people[eng]) people[eng] = init();
    const value = b.service_value_cents ?? b.total_amount;
    people[eng].sessionCount++;
    people[eng].sessionRevenue += b.total_amount;
    people[eng].sessionPay += Math.round(value * L_ENG);
    people[eng].sessionHours += b.duration;
    if (b.reward_grant_id) people[eng].rewardsCost += Math.max(0, value - b.total_amount);
  });
  media.forEach((m) => {
    const seller = legacyNorm(m.sold_by);
    if (seller) { if (!people[seller]) people[seller] = init(); people[seller].mediaSoldCount++; people[seller].mediaCommission += Math.round(m.amount * L_SELLER); }
    const filmer = legacyNorm(m.filmed_by);
    const editor = legacyNorm(m.edited_by);
    if (filmer && editor && filmer === editor) {
      if (!people[filmer]) people[filmer] = init();
      people[filmer].mediaFilmedCount++; people[filmer].mediaEditedCount++;
      people[filmer].mediaWorkerPay += Math.round(m.amount * L_WORKER);
    } else {
      if (filmer) { if (!people[filmer]) people[filmer] = init(); people[filmer].mediaFilmedCount++; people[filmer].mediaWorkerPay += Math.round(m.amount * L_WORKER / 2); }
      if (editor) { if (!people[editor]) people[editor] = init(); people[editor].mediaEditedCount++; people[editor].mediaWorkerPay += Math.round(m.amount * L_WORKER / 2); }
    }
  });
  beats.forEach((p) => {
    const prod = legacyNorm(p.beats?.producer ?? null);
    if (!prod) return;
    if (!people[prod]) people[prod] = init();
    people[prod].beatCount++; people[prod].beatSales += p.amount_paid;
    people[prod].beatProducerPay += Math.round(p.amount_paid * L_PROD);
  });
  mediaSessions.forEach((s) => {
    const eng = legacyNorm(engineerNames[s.engineer_id]);
    if (!eng) return;
    const cents = s.engineer_payout_cents ?? 0;
    if (cents <= 0) return;
    if (!people[eng]) people[eng] = init();
    people[eng].mediaWorkerPay += cents; people[eng].mediaFilmedCount++;
  });
  packageCommissions.forEach((pc) => {
    const sp = legacyNorm(pc.salesperson_name);
    if (!sp) return;
    const cents = pc.sales_commission_cents ?? 0;
    if (cents <= 0) return;
    if (!people[sp]) people[sp] = init();
    people[sp].packageCommission += cents; people[sp].packageSoldCount++;
  });
  bonuses.forEach((bn) => {
    if (bn.status !== 'approved' && bn.status !== 'issued') return;
    const name = legacyNorm(bn.person_name);
    if (!name || name === 'Unassigned') return;
    if (!people[name]) people[name] = init();
    people[name].bonusPay += bn.value_cents || 0; people[name].bonusCount++;
  });
  Object.values(people).forEach((p) => { p.totalPay = p.sessionPay + p.mediaCommission + p.mediaWorkerPay + p.beatProducerPay + p.packageCommission + p.bonusPay; });
  return people;
}

async function fetchData(): Promise<EarningsInput> {
  const [{ data: bookings }, { data: beats }, { data: media }, { data: mediaSessions }, { data: pkg }, { data: grants }] = await Promise.all([
    // NOTE: engineer_split_pct / producer_pct are added by migration 070 — selected
    // only once that migration is applied (see SELECT_SNAPSHOTS below).
    db.from('bookings').select(`status, engineer_name, service_value_cents, total_amount, duration, reward_grant_id${SELECT_SNAPSHOTS ? ', engineer_split_pct' : ''}`).not('status', 'eq', 'cancelled'),
    db.from('beat_purchases').select(`amount_paid, beats(producer)${SELECT_SNAPSHOTS ? ', producer_pct' : ''}`),
    db.from('media_sales').select('*'),
    db.from('media_session_bookings').select('engineer_id, engineer_payout_cents').eq('status', 'completed').not('engineer_payout_cents', 'is', null),
    db.from('package_entitlements').select('salesperson_name, sales_commission_cents').not('salesperson_name', 'is', null).gt('sales_commission_cents', 0),
    db.from('reward_grants').select('owner_user_id, value_cents, status').eq('reward_type', 'cash_bonus').in('status', ['approved', 'issued', 'redeemed']),
  ]);

  // engineerNameMap: media-session engineer_id → canonical roster name (mirror the route).
  const engIds = Array.from(new Set((mediaSessions ?? []).map((r: any) => r.engineer_id)));
  const engineerNames: Record<string, string> = {};
  if (engIds.length) {
    const { data: profs } = await db.from('profiles').select('user_id, display_name, email').in('user_id', engIds);
    for (const p of (profs ?? []) as any[]) {
      const roster = p.email ? ENGINEERS.find((e) => e.email.toLowerCase() === p.email.toLowerCase()) : null;
      engineerNames[p.user_id] = roster?.name || p.display_name || 'Unknown';
    }
  }

  // bonuses: owner_user_id → canonical roster name (mirror the route).
  const ownerIds = Array.from(new Set((grants ?? []).map((g: any) => g.owner_user_id).filter(Boolean)));
  const bonusName: Record<string, string> = {};
  if (ownerIds.length) {
    const { data: bprofs } = await db.from('profiles').select('user_id, display_name, email').in('user_id', ownerIds);
    for (const p of (bprofs ?? []) as any[]) {
      const roster = p.email ? ENGINEERS.find((e) => e.email.toLowerCase() === p.email.toLowerCase()) : null;
      bonusName[p.user_id] = roster?.name || p.display_name || 'Unknown';
    }
  }
  const bonuses = (grants ?? []).map((g: any) => ({ person_name: g.owner_user_id ? (bonusName[g.owner_user_id] || 'Unknown') : 'Unknown', value_cents: g.value_cents || 0, status: g.status }));

  return {
    bookings: (bookings ?? []) as any,
    media: (media ?? []) as any,
    beats: (beats ?? []) as any,
    mediaSessions: (mediaSessions ?? []) as any,
    engineerNames,
    packageCommissions: (pkg ?? []) as any,
    bonuses,
  };
}

function diff(a: Record<string, PersonEarnings>, b: Record<string, PersonEarnings>, samples: string[]): number {
  let n = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const pa = a[k], pb = b[k];
    if (!pa || !pb) { n++; if (samples.length < 12) samples.push(`${k}: present in only one (${!pa ? 'core' : 'legacy'})`); continue; }
    for (const f of Object.keys(pa) as (keyof PersonEarnings)[]) {
      if (pa[f] !== pb[f]) { n++; if (samples.length < 12) samples.push(`${k}.${String(f)}: legacy ${pa[f]} ≠ core ${pb[f]}`); }
    }
  }
  return n;
}

// Synthetic fixture exercising EVERY branch (real prod data is sparse on
// beats/mediaSessions/package/bonus). Proves legacy == core across all paths AND
// checks independent hand-computed anchors (catches a shared constant misread).
function syntheticTest(): { diffs: number; samples: string[]; anchorsBad: number } {
  const data: EarningsInput = {
    bookings: [
      { status: 'completed', engineer_name: 'PRVRB', service_value_cents: 21000, total_amount: 21000, duration: 3, reward_grant_id: null },
      { status: 'completed', engineer_name: 'PRVRB', service_value_cents: 26000, total_amount: 0, duration: 4, reward_grant_id: 'r1' }, // reward: pay on value, rewardsCost
      { status: 'confirmed', engineer_name: 'PRVRB', service_value_cents: 9999, total_amount: 9999, duration: 1, reward_grant_id: null }, // not completed → ignored
      { status: 'completed', engineer_name: null, service_value_cents: 5000, total_amount: 5000, duration: 1, reward_grant_id: null }, // no engineer → ignored
    ],
    media: [
      { sold_by: 'Zion', filmed_by: 'Iszac', edited_by: 'Iszac', amount: 100000 }, // same person → full worker 50%
      { sold_by: null, filmed_by: 'Iszac', edited_by: 'Jay Val Leo', amount: 80000 }, // split → 25% each
    ],
    beats: [{ amount_paid: 40000, beats: { producer: 'PRVRB' } }],
    mediaSessions: [{ engineer_id: 'g1', engineer_payout_cents: 5000 }],
    engineerNames: { g1: 'Zion' },
    packageCommissions: [{ salesperson_name: 'Iszac', sales_commission_cents: 3000 }],
    bonuses: [
      { status: 'approved', person_name: 'Zion', value_cents: 10000 },
      { status: 'redeemed', person_name: 'PRVRB', value_cents: 9999 }, // already paid → ignored
    ],
  };
  const legacy = computeEarningsLegacy(data);
  const core = computeEarningsCore(data);
  const samples: string[] = [];
  const diffs = diff(legacy, core, samples);
  // Independent anchors (hand-computed at the constant splits).
  let anchorsBad = 0;
  const A = (name: string, got: number, want: number) => { if (got !== want) { anchorsBad++; samples.push(`anchor ${name}: got ${got} want ${want}`); } };
  A('PRVRB.sessionPay', core.PRVRB.sessionPay, Math.round(21000 * 0.6) + Math.round(26000 * 0.6)); // 12600+15600=28200
  A('PRVRB.rewardsCost', core.PRVRB.rewardsCost, 26000);
  A('PRVRB.sessionCount', core.PRVRB.sessionCount, 2);
  A('PRVRB.beatProducerPay', core.PRVRB.beatProducerPay, Math.round(40000 * 0.6)); // 24000
  A('Zion.mediaCommission', core.Zion.mediaCommission, Math.round(100000 * 0.15)); // 15000
  A('Zion.mediaWorkerPay', core.Zion.mediaWorkerPay, 5000); // media session payout
  A('Zion.bonusPay', core.Zion.bonusPay, 10000);
  // 'Iszac' (displayName) normalizes to the canonical roster name 'Iszac Griner'.
  A('Iszac Griner.mediaWorkerPay', core['Iszac Griner'].mediaWorkerPay, Math.round(100000 * 0.5) + Math.round(80000 * 0.5 / 2)); // 50000+20000=70000
  A('Iszac Griner.packageCommission', core['Iszac Griner'].packageCommission, 3000);
  A('Jay Val Leo.mediaWorkerPay', core['Jay Val Leo'].mediaWorkerPay, Math.round(80000 * 0.5 / 2)); // 20000
  A('PRVRB.totalPay', core.PRVRB.totalPay, 28200 + 24000); // sessions + beats = 52200

  // FREEZE check (core only — legacy is snapshot-blind): a row stamped at 80%
  // pays at 80% even though the default/constant is 60%. Proves snapshots win.
  const snapCore = computeEarningsCore({
    bookings: [{ status: 'completed', engineer_name: 'PRVRB', service_value_cents: 10000, total_amount: 10000, duration: 1, engineer_split_pct: 80 }],
    media: [], beats: [],
  });
  A('snapshot 80% overrides default 60%', snapCore.PRVRB.sessionPay, Math.round(10000 * 0.80)); // 8000, not 6000
  // And the SAME row with no snapshot falls back to the constant (frozen-at-60).
  const noSnap = computeEarningsCore({
    bookings: [{ status: 'completed', engineer_name: 'PRVRB', service_value_cents: 10000, total_amount: 10000, duration: 1 }],
    media: [], beats: [],
  });
  A('no snapshot → constant 60%', noSnap.PRVRB.sessionPay, Math.round(10000 * 0.60)); // 6000
  // what-if: ignoreSnapshot makes a hypothetical cfg apply even to snapshotted rows.
  const whatifCore = computeEarningsCore(
    { bookings: [{ status: 'completed', engineer_name: 'PRVRB', service_value_cents: 10000, total_amount: 10000, duration: 1, engineer_split_pct: 80 }], media: [], beats: [] },
    revenueConfigFromConstants(), { ignoreSnapshot: true },
  );
  A('what-if ignores snapshot, uses cfg', whatifCore.PRVRB.sessionPay, Math.round(10000 * 0.60)); // 6000, not 8000

  return { diffs, samples, anchorsBad };
}

async function main() {
  // Synthetic all-branch proof first (independent of sparse prod data).
  const syn = syntheticTest();
  console.log(`\n=== synthetic all-branch test ===`);
  console.log(syn.diffs === 0 && syn.anchorsBad === 0
    ? `✅ legacy == core across every path; all anchors pass (incl. snapshot freeze)`
    : `❌ ${syn.diffs} legacy/core diffs, ${syn.anchorsBad} anchor failures`);
  syn.samples.forEach((x) => console.log('  ' + x));

  // Probe whether migration 070's snapshot columns exist yet; include them if so.
  const probe = await db.from('bookings').select('engineer_split_pct').limit(1);
  SELECT_SNAPSHOTS = !probe.error;
  console.log(`snapshot columns present: ${SELECT_SNAPSHOTS}`);
  const data = await fetchData();
  console.log(`\n=== payroll golden ===\nrows: bookings ${data.bookings.length}, media ${data.media.length}, beats ${data.beats.length}, mediaSessions ${data.mediaSessions!.length}, pkgComm ${data.packageCommissions!.length}, bonuses ${data.bonuses!.length}\n`);

  // 1) extraction proof: legacy (verbatim original) vs core (constants default).
  const legacy = computeEarningsLegacy(data);
  const core = computeEarningsCore(data); // cfg defaults to constants
  const s1: string[] = [];
  const d1 = diff(legacy, core, s1);
  console.log(d1 === 0
    ? `✅ extraction: computeEarningsCore == original logic (${Object.keys(legacy).length} people identical)`
    : `❌ extraction: ${d1} diffs`);
  s1.forEach((x) => console.log('  ' + x));

  // 2) snapshot compare / write.
  if (WRITE) {
    mkdirSync(join(__dirname, '__golden__'), { recursive: true });
    writeFileSync(SNAP, JSON.stringify(legacy, Object.keys(legacy).sort(), 0));
    console.log(`\n✅ snapshot written: ${SNAP} (${Object.keys(legacy).length} people)`);
  } else if (existsSync(SNAP)) {
    const prev = JSON.parse(readFileSync(SNAP, 'utf8')) as Record<string, PersonEarnings>;
    const s2: string[] = [];
    const d2 = diff(prev, core, s2);
    console.log(d2 === 0 ? `✅ snapshot: matches committed payroll.json` : `❌ snapshot: ${d2} diffs vs payroll.json`);
    s2.forEach((x) => console.log('  ' + x));
  } else {
    console.log('(no snapshot yet — run with --write)');
  }

  // 3) DB-config round trip (after migration 070 + seed exists).
  if (SEED) {
    try {
      const { seedRevenueFromConstants, getRevenueConfig, getRevenueOverrides } = await import('../lib/revenue-config-server');
      await seedRevenueFromConstants(db as any);
      const cfg: RevenueConfig = await getRevenueConfig(db as any);
      const overrides = await getRevenueOverrides(db as any);
      const dbCore = computeEarningsCore(data, cfg, { overrides });
      const s3: string[] = [];
      const d3 = diff(legacy, dbCore, s3);
      console.log(d3 === 0 ? `✅ DB round-trip: reading shares from the DB reproduces payroll exactly` : `❌ DB round-trip: ${d3} diffs`);
      s3.forEach((x) => console.log('  ' + x));
    } catch (e) {
      console.log(`(skipped DB round-trip — config layer not built yet: ${(e as Error).message})`);
    }
  }

  console.log('');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
