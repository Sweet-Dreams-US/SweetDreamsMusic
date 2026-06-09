// scripts/agent-console-test.ts — golden test for the Agent Stats Console.
// Run: npx tsx --env-file=.env.local scripts/agent-console-test.ts
//
// PURE: weekday slicing, due/missed/done logic, anomaly threshold, field map.
// LIVE (service client, test account cole@sweetdreams.us only): seeded platform
// links + prior snapshots → saveAgentMetrics → asserts metric rows, connection
// stamps, anomaly confirm + flag, duplicate rejection, API-prefill merge, run
// counters, queue exclusion of the test account, tracking-status view shape.
// Writes ONLY rows owned by the test user (platform_connections + artist_metrics
// on seeded platforms + agent_runs) — ALL deleted in finally.

import { createClient } from '@supabase/supabase-js';
import {
  AGENT_PLATFORMS, weekdaySlot, computeDue, isAnomalous, daysBetween, studioToday,
} from '../lib/agent-stats';
import {
  buildAgentQueue, getArtistWork, saveAgentMetrics, startAgentRun, finishAgentRun,
  clearAnomalyFlag,
} from '../lib/agent-stats-server';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing env. Run with --env-file=.env.local'); process.exit(1); }
const db = createClient(URL, KEY);

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const TEST_EMAIL = 'cole@sweetdreams.us';
const SEED_PLATFORMS = ['tiktok', 'spotify', 'soundcloud', 'audiomack', 'deezer'];
let testUserId = '';
const cleanupRunIds: string[] = [];
const cleanupDates = new Set<string>();

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function main() {
  // ── PURE ────────────────────────────────────────────────────────────────
  console.log('\n— Pure: weekday slicing —');
  const u = '0a1b2c3d-0000-0000-0000-000000000000';
  ok('slot is stable', weekdaySlot(u) === weekdaySlot(u));
  ok('slot in 0..4', [u, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    .every((id) => weekdaySlot(id) >= 0 && weekdaySlot(id) <= 4));

  // A user whose slot we control by picking ids until we find slots 0 and 2.
  const idFor = (slot: number) => {
    for (let i = 0; i < 5000; i++) {
      const id = `${(i * 7919).toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;
      if (weekdaySlot(id) === slot) return id;
    }
    throw new Error('no id found');
  };
  const wed = { dateStr: '2026-06-10', dayIdx: 2 }; // a Wednesday
  ok('due on own weekday', computeDue({ userId: idFor(2), lastAgentDate: null }, wed).dueToday);
  ok('not due on later weekday', !computeDue({ userId: idFor(4), lastAgentDate: null }, wed).include);
  const missedStale = computeDue({ userId: idFor(0), lastAgentDate: '2026-05-20' }, wed);
  ok('missed earlier slot + stale ⇒ included', missedStale.include && missedStale.missed);
  ok('missed earlier slot but recent ⇒ excluded',
    !computeDue({ userId: idFor(0), lastAgentDate: '2026-06-08' }, wed).include);
  ok('done when snapshot is today', computeDue({ userId: idFor(2), lastAgentDate: '2026-06-10' }, wed).done);
  const sat = { dateStr: '2026-06-13', dayIdx: 5 };
  ok('weekend = catch-up for any stale slot',
    computeDue({ userId: idFor(4), lastAgentDate: null }, sat).include);
  ok('weekend excludes recent', !computeDue({ userId: idFor(4), lastAgentDate: '2026-06-12' }, sat).include);
  // Cross-week blind spot (review finding): a Friday-slot artist missed on
  // Friday + weekend must surface MONDAY, not vanish until next Friday.
  const mon = { dateStr: '2026-06-15', dayIdx: 0 };
  const fridaySlotStale = computeDue({ userId: idFor(4), lastAgentDate: '2026-06-05' }, mon);
  ok('cross-week miss surfaces Monday', fridaySlotStale.include && fridaySlotStale.missed);
  ok('never-recorded later slot still waits for its first day',
    !computeDue({ userId: idFor(4), lastAgentDate: null }, mon).include);

  console.log('\n— Pure: anomaly + field map —');
  ok('+60% is anomalous', isAnomalous(100, 160));
  ok('-60% is anomalous', isAnomalous(100, 40));
  ok('+40% is fine', !isAnomalous(100, 140));
  ok('no baseline ⇒ never anomalous', !isAnomalous(null, 99999) && !isAnomalous(0, 50));
  const REAL_COLUMNS = new Set(['followers', 'monthly_listeners', 'subscribers', 'total_views', 'plays', 'total_likes']);
  ok('field map uses only real artist_metrics columns',
    AGENT_PLATFORMS.every((p) => p.fields.every((f) => REAL_COLUMNS.has(f.column))));
  ok('apple_music is NOT agent-recordable (screenshot flow)',
    !AGENT_PLATFORMS.some((p) => p.key === 'apple_music'));
  ok('daysBetween basic', daysBetween('2026-06-01', '2026-06-08') === 7);

  // ── LIVE ────────────────────────────────────────────────────────────────
  console.log('\n— Live: setup (test account only) —');
  const { data: prof } = await db.from('profiles').select('user_id,email').ilike('email', TEST_EMAIL).maybeSingle();
  if (!prof) throw new Error(`test user ${TEST_EMAIL} not found`);
  testUserId = (prof as { user_id: string }).user_id;

  const today = studioToday();
  cleanupDates.add(today.dateStr);
  const d3 = shiftDate(today.dateStr, -3); cleanupDates.add(d3);
  const d8 = shiftDate(today.dateStr, -8); cleanupDates.add(d8);

  // Seed connections (tiktok/spotify/soundcloud/audiomack/deezer) + history.
  for (const platform of SEED_PLATFORMS) {
    await db.from('platform_connections').upsert({
      user_id: testUserId, platform, platform_url: `https://example.com/${platform}/test`,
      auto_fetch_enabled: false, metadata: { test: true },
    }, { onConflict: 'user_id,platform' });
  }
  // tiktok: agent snapshot 8 days ago (anomaly baseline; outside the dup window).
  await db.from('artist_metrics').upsert({
    user_id: testUserId, platform: 'tiktok', metric_date: d8,
    followers: 1000, source: 'agent', metadata: { test: true },
  }, { onConflict: 'user_id,metric_date,platform' });
  // soundcloud: agent snapshot 3 days ago (inside the dup window).
  await db.from('artist_metrics').upsert({
    user_id: testUserId, platform: 'soundcloud', metric_date: d3,
    followers: 500, source: 'agent', metadata: { test: true },
  }, { onConflict: 'user_id,metric_date,platform' });
  // spotify: API prefill row TODAY (merge test).
  await db.from('artist_metrics').upsert({
    user_id: testUserId, platform: 'spotify', metric_date: today.dateStr,
    followers: 100, popularity_score: 55, source: 'spotify_api', metadata: { test: true },
  }, { onConflict: 'user_id,metric_date,platform' });
  console.log(`  seeded for ${testUserId} (${today.dateStr})`);

  console.log('\n— Live: work screen payload —');
  const work = await getArtistWork(db as never, testUserId);
  ok('artist resolves', !!work);
  const tk = work!.platforms.find((p) => p.key === 'tiktok')!;
  ok('tiktok link present', tk.connection?.url === 'https://example.com/tiktok/test');
  ok('tiktok lastAgent baseline shows 1000', tk.lastAgent?.values.followers === 1000);
  const sp = work!.platforms.find((p) => p.key === 'spotify')!;
  ok('spotify prefill from API today', sp.prefill?.source === 'spotify_api' && sp.prefill?.values.followers === 100);
  ok('platform with no link has null connection',
    work!.platforms.find((p) => p.key === 'facebook')!.connection === null);

  console.log('\n— Live: run + clean save + stamps —');
  const run = await startAgentRun(db as never, testUserId);
  cleanupRunIds.push((run as { id: string }).id);
  const run2 = await startAgentRun(db as never, testUserId);
  ok('start is idempotent (same open run)', (run2 as { id: string }).id === (run as { id: string }).id);

  const save1 = await saveAgentMetrics(db as never, {
    userId: testUserId, recordedBy: testUserId, runId: (run as { id: string }).id,
    entries: [
      { platform: 'tiktok', status: 'recorded', values: { followers: 1200 } }, // +20% — clean
      { platform: 'audiomack', status: 'blocked' },
    ],
  });
  ok('clean save needs no confirmation', !save1.needsConfirmation);
  if (!save1.needsConfirmation) {
    ok('tiktok saved', save1.saved.includes('tiktok'));
    ok('no anomalies flagged', save1.anomaliesFlagged === 0);
  }
  const { data: tkRow } = await db.from('artist_metrics').select('*')
    .eq('user_id', testUserId).eq('platform', 'tiktok').eq('metric_date', today.dateStr).maybeSingle();
  ok('row source=agent + recorded_by stamped',
    (tkRow as { source?: string })?.source === 'agent' && (tkRow as { recorded_by?: string })?.recorded_by === testUserId);
  const { data: tkConn } = await db.from('platform_connections').select('last_fetched_at,fetch_error')
    .eq('user_id', testUserId).eq('platform', 'tiktok').maybeSingle();
  ok('tiktok connection stamped clean', !!(tkConn as { last_fetched_at?: string })?.last_fetched_at && (tkConn as { fetch_error?: string })?.fetch_error === null);
  const { data: amConn } = await db.from('platform_connections').select('fetch_error')
    .eq('user_id', testUserId).eq('platform', 'audiomack').maybeSingle();
  ok('blocked status stamped on connection', (amConn as { fetch_error?: string })?.fetch_error === 'blocked');

  console.log('\n— Live: anomaly confirm flow (same-day correction) —');
  const save2 = await saveAgentMetrics(db as never, {
    userId: testUserId, recordedBy: testUserId, runId: (run as { id: string }).id,
    entries: [{ platform: 'tiktok', status: 'recorded', values: { followers: 5000 } }], // 400% vs 1000 baseline
  });
  ok('big swing demands confirmation', save2.needsConfirmation === true);
  if (save2.needsConfirmation) {
    ok('anomaly detail correct', save2.anomalies[0]?.platform === 'tiktok' && save2.anomalies[0]?.previous === 1000);
  }
  const save2b = await saveAgentMetrics(db as never, {
    userId: testUserId, recordedBy: testUserId, runId: (run as { id: string }).id,
    entries: [{ platform: 'tiktok', status: 'recorded', values: { followers: 5000 } }],
    confirmAnomalies: true,
  });
  ok('confirmed save succeeds', !save2b.needsConfirmation && (save2b as { saved: string[] }).saved.includes('tiktok'));
  const { data: tkRow2 } = await db.from('artist_metrics').select('metadata,followers')
    .eq('user_id', testUserId).eq('platform', 'tiktok').eq('metric_date', today.dateStr).maybeSingle();
  ok('anomaly flag persisted', (tkRow2 as { metadata?: { anomaly?: boolean } })?.metadata?.anomaly === true);
  ok('same-day correction overwrote value', (tkRow2 as { followers?: number })?.followers === 5000);
  const { data: chartRows } = await db.from('chart_eligible_metrics').select('id')
    .eq('user_id', testUserId).eq('platform', 'tiktok').eq('metric_date', today.dateStr);
  ok('anomalous row held out of charts', (chartRows ?? []).length === 0);

  console.log('\n— Live: duplicate rejection + API-prefill merge —');
  const save3 = await saveAgentMetrics(db as never, {
    userId: testUserId, recordedBy: testUserId, runId: (run as { id: string }).id,
    entries: [
      { platform: 'soundcloud', status: 'recorded', values: { followers: 510 } }, // snapshot 3d ago → reject
      { platform: 'spotify', status: 'recorded', values: { monthly_listeners: 2000, followers: 105 } },
    ],
  });
  ok('save3 not blocked on confirmation', !save3.needsConfirmation);
  if (!save3.needsConfirmation) {
    ok('soundcloud rejected as duplicate', save3.rejected.some((r) => r.platform === 'soundcloud' && r.reason === 'duplicate_within_6_days'));
    ok('spotify saved alongside rejection', save3.saved.includes('spotify'));
  }
  const { data: spRow } = await db.from('artist_metrics').select('*')
    .eq('user_id', testUserId).eq('platform', 'spotify').eq('metric_date', today.dateStr).maybeSingle();
  const spTyped = spRow as { source?: string; monthly_listeners?: number; popularity_score?: number } | null;
  ok('agent save merged over API row (source flips, API fields survive)',
    spTyped?.source === 'agent' && spTyped?.monthly_listeners === 2000 && spTyped?.popularity_score === 55);
  const { data: scConn } = await db.from('platform_connections').select('last_fetched_at')
    .eq('user_id', testUserId).eq('platform', 'soundcloud').maybeSingle();
  ok('rejected platform NOT stamped', (scConn as { last_fetched_at?: string | null })?.last_fetched_at === null);

  console.log('\n— Live: run counters + finish —');
  const finished = await finishAgentRun(db as never, (run as { id: string }).id);
  const f = finished as { artists_processed: number; platforms_recorded: number; blocked_count: number; anomaly_count: number; finished_at: string | null };
  ok('artists_processed deduped across revisits (3 saves, 1 artist)', f.artists_processed === 1);
  ok('platforms_recorded counted', f.platforms_recorded >= 3);
  ok('blocked counted', f.blocked_count >= 1);
  ok('anomaly counted', f.anomaly_count >= 1);
  ok('finished_at stamped', !!f.finished_at);

  console.log('\n— Live: anomaly clear path (review finding) —');
  const cleared = await clearAnomalyFlag(db as never, { userId: testUserId, platform: 'tiktok', metricDate: today.dateStr });
  ok('clearAnomalyFlag succeeds on flagged row', cleared);
  const { data: tkRow3 } = await db.from('artist_metrics').select('metadata')
    .eq('user_id', testUserId).eq('platform', 'tiktok').eq('metric_date', today.dateStr).maybeSingle();
  const md3 = (tkRow3 as { metadata?: Record<string, unknown> })?.metadata;
  ok('flag removed + audit stamp left', md3?.anomaly === undefined && !!md3?.anomaly_cleared_at);
  ok('clear is a no-op on unknown rows',
    !(await clearAnomalyFlag(db as never, { userId: testUserId, platform: 'tiktok', metricDate: '1999-01-01' })));

  console.log('\n— Live: queue exclusions + tracking view —');
  const queue = await buildAgentQueue(db as never);
  ok('test account NEVER appears in the queue', !queue.artists.some((a) => a.userId === testUserId));
  // Authz bound (review finding): an off-program user (no platform links) must
  // be unreadable through getArtistWork even on the service client.
  const { data: offProgram } = await db.from('profiles').select('user_id')
    .neq('user_id', testUserId).limit(50);
  const { data: connectedIds } = await db.from('platform_connections').select('user_id');
  const connectedSet = new Set(((connectedIds ?? []) as { user_id: string }[]).map((c) => c.user_id));
  const offUser = ((offProgram ?? []) as { user_id: string }[]).find((p) => !connectedSet.has(p.user_id));
  if (offUser) {
    ok('off-program user is unreadable (null)', (await getArtistWork(db as never, offUser.user_id)) === null);
  }
  const { data: tsRow } = await db.from('artist_tracking_status').select('*').eq('user_id', testUserId).maybeSingle();
  ok('tracking view returns a row with boolean is_active', typeof (tsRow as { is_active?: boolean })?.is_active === 'boolean');
  const { data: inactiveSample } = await db.from('artist_tracking_status').select('user_id').eq('is_active', false).limit(1);
  ok('view distinguishes inactive artists (not everyone active)', (inactiveSample ?? []).length === 1);
}

async function cleanup() {
  if (!testUserId) return;
  await db.from('artist_metrics').delete()
    .eq('user_id', testUserId).in('platform', SEED_PLATFORMS)
    .in('metric_date', Array.from(cleanupDates));
  await db.from('platform_connections').delete()
    .eq('user_id', testUserId).in('platform', SEED_PLATFORMS);
  if (cleanupRunIds.length) await db.from('agent_runs').delete().in('id', cleanupRunIds);
  // Belt-and-suspenders: anything test-tagged we own.
  await db.from('artist_metrics').delete().eq('user_id', testUserId).contains('metadata', { test: true });
  console.log('\ncleaned up test rows');
}

main()
  .catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n${fail === 0 ? '✅ AGENT CONSOLE: ALL PASS' : `❌ ${fail} FAILED: ${failures.join(', ')}`}  (${pass} passed)\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
