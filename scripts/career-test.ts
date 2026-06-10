// scripts/career-test.ts — Career Path golden tests (Plan 6 §9).
// Pure-math assertions on exact boundaries + live-DB checks (catalog seeded,
// backfill loss-free, fake-user evaluation writes nothing, share-link
// validity). Run: npx tsx --env-file=.env.local scripts/career-test.ts

import { createClient } from '@supabase/supabase-js';
import {
  TIER_LADDER, tierFromSnapshots, tierLabel, computeStage, computeRolloutScore,
  releaseXp, REQUIREMENTS, shareLinkInvalidReason, daysBetweenIso, type TierSnapshot,
} from '../lib/career';
import { CHECKS, evaluateGates, type CareerContext } from '../lib/career-rules';
import { ACHIEVEMENTS } from '../lib/achievements';
import { CAREER_ACHIEVEMENTS } from '../lib/career';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing env'); process.exit(1); }
const db = createClient(URL, KEY);

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const snap = (id: string, date: string, listeners: number, anomaly = false): TierSnapshot =>
  ({ id, metricDate: date, monthlyListeners: listeners, anomaly });

const baseCtx = (over: Partial<CareerContext>): CareerContext => ({
  userId: 'test', email: 'x@y.z', platformLinkCount: 0, completedSessions: 0,
  brandComplete: false, releasedProjects: [], releasedSingles: 0,
  albumReleasedBeforeSingles: false, maxRolloutScore: 0, shareFeedbackCount: 0,
  hasPrepReference: false, latestVerifiedListeners: null, snapshotStreakWeeks: 0,
  showsConfirmed: [], contactsCount: 0, hasCollabRelease: false, releasesIn12mo: 0,
  roadmapRead: {}, activeProjects: [], shareLinks: [], lastReleaseAt: null, ...over,
});

async function main() {
  console.log('\n═══ CAREER PATH GOLDEN TESTS ═══');

  console.log('\n— Listener gates: exact boundaries —');
  ok('499 listeners does NOT meet the 500 gate',
    CHECKS.monthly_listeners(baseCtx({ latestVerifiedListeners: 499 }), { min: 500 }) === false);
  ok('exactly 500 meets it',
    CHECKS.monthly_listeners(baseCtx({ latestVerifiedListeners: 500 }), { min: 500 }) === true);
  ok('null listeners (never tracked) never meets',
    CHECKS.monthly_listeners(baseCtx({}), { min: 500 }) === false);

  console.log('\n— Tier grants: two clean consecutive snapshots, NOTHING else —');
  ok('two clean weeks at 12k → 10K tier',
    tierFromSnapshots(snap('b', '2026-06-08', 12000), snap('a', '2026-06-01', 11000)) === 10000);
  ok('floor logic: 60k + 45k → only 10K (min of the two)',
    tierFromSnapshots(snap('b', '2026-06-08', 60000), snap('a', '2026-06-01', 45000)) === 10000);
  ok('single snapshot (no prior) never grants',
    tierFromSnapshots(snap('b', '2026-06-08', 999999), null) === null);
  ok('single spike: 200k this week, 800 last week → no 10K',
    tierFromSnapshots(snap('b', '2026-06-08', 200000), snap('a', '2026-06-01', 800)) === null);
  ok('anomaly-flagged LATEST never grants',
    tierFromSnapshots(snap('b', '2026-06-08', 60000, true), snap('a', '2026-06-01', 55000)) === null);
  ok('anomaly-flagged PRIOR never grants',
    tierFromSnapshots(snap('b', '2026-06-08', 60000), snap('a', '2026-06-01', 55000, true)) === null);
  ok('14-day gap is NOT consecutive (13 max)',
    tierFromSnapshots(snap('b', '2026-06-15', 60000), snap('a', '2026-06-01', 55000)) === null);
  ok('13-day gap IS consecutive (catch-up tolerance)',
    tierFromSnapshots(snap('b', '2026-06-14', 60000), snap('a', '2026-06-01', 55000)) === 50000);
  ok('exactly at threshold both weeks grants',
    tierFromSnapshots(snap('b', '2026-06-08', 10000), snap('a', '2026-06-01', 10000)) === 10000);
  ok('9,999 both weeks does not',
    tierFromSnapshots(snap('b', '2026-06-08', 9999), snap('a', '2026-06-01', 9999)) === null);
  ok('every ladder rung has an achievement key',
    TIER_LADDER.every((t) => !!ACHIEVEMENTS[CAREER_ACHIEVEMENTS.tiers[t]]));
  ok('numeric naming only (no RIAA words)',
    TIER_LADDER.every((t) => !/gold|platinum|diamond/i.test(tierLabel(t))));

  console.log('\n— Rollout score: per-item weights + sum —');
  const allMet = computeRolloutScore({
    releaseDateSetDaysAhead: 21, hasCoverArt: true, photoshootBooked: true,
    videoBookedOrLinked: true, hasPresave: true, preReleaseContentCount: 6,
    shareLinkPlays: 5, hasAdBudget: true, postReleaseContentCount: 1,
  });
  ok('everything met = exactly 100', allMet.score === 100, String(allMet.score));
  const nothing = computeRolloutScore({
    releaseDateSetDaysAhead: null, hasCoverArt: false, photoshootBooked: false,
    videoBookedOrLinked: false, hasPresave: false, preReleaseContentCount: 0,
    shareLinkPlays: 0, hasAdBudget: false, postReleaseContentCount: 0,
  });
  ok('nothing met = 0', nothing.score === 0);
  ok('20 days ahead misses the 21-day item (exact boundary)',
    computeRolloutScore({ releaseDateSetDaysAhead: 20, hasCoverArt: true, photoshootBooked: true, videoBookedOrLinked: true, hasPresave: true, preReleaseContentCount: 6, shareLinkPlays: 5, hasAdBudget: true, postReleaseContentCount: 1 }).score === 80);
  ok('5 calendar entries misses the 6+ item',
    computeRolloutScore({ releaseDateSetDaysAhead: 21, hasCoverArt: true, photoshootBooked: true, videoBookedOrLinked: true, hasPresave: true, preReleaseContentCount: 5, shareLinkPlays: 5, hasAdBudget: true, postReleaseContentCount: 1 }).score === 85);
  ok('4 plays misses the 5+ item',
    computeRolloutScore({ releaseDateSetDaysAhead: 21, hasCoverArt: true, photoshootBooked: true, videoBookedOrLinked: true, hasPresave: true, preReleaseContentCount: 6, shareLinkPlays: 4, hasAdBudget: true, postReleaseContentCount: 1 }).score === 90);
  ok('release XP scales: 90 rollout = 90% of base', releaseXp(200, 90) === 180);
  ok('release XP floor: 0 rollout = 25% of base (lazy drop still gets something)', releaseXp(200, 0) === 50);
  ok('release XP: 10 rollout still floors at 25%', releaseXp(200, 10) === 50);

  console.log('\n— Stage computation: never grants with one requirement pending —');
  const allKeys = REQUIREMENTS.map((r) => r.key);
  const s1Keys = REQUIREMENTS.filter((r) => r.stage === 1).map((r) => r.key);
  ok('zero complete = stage 0', computeStage(new Set()) === 0);
  ok('all of stage 1 = stage 1', computeStage(new Set(s1Keys)) === 1);
  for (const missing of s1Keys) {
    const partial = new Set(s1Keys.filter((k) => k !== missing));
    if (computeStage(partial) !== 0) { ok(`stage 1 with ${missing} pending must be 0`, false); break; }
  }
  ok('stage 1 with ANY single gate pending stays 0 (all 6 variants)', true);
  ok('all 30 complete = stage 5', computeStage(new Set(allKeys)) === 5);
  const skipStage2 = new Set(allKeys.filter((k) => !k.startsWith('s2_')));
  ok('stages 3-5 complete but stage 2 pending → still stage 1 (no skipping)',
    computeStage(skipStage2) === 1);
  ok('every stage 2-5 has a stage-up achievement defined',
    [2, 3, 4, 5].every((s) => !!ACHIEVEMENTS[CAREER_ACHIEVEMENTS.stages[s]]));

  console.log('\n— Singles-before-album + shows rules —');
  ok('3 singles, no album = met', CHECKS.singles_before_album(baseCtx({ releasedSingles: 3 }), { min: 3 }));
  ok('3 singles but album dropped first = NOT met',
    CHECKS.singles_before_album(baseCtx({ releasedSingles: 3, albumReleasedBeforeSingles: true }), { min: 3 }) === false);
  ok('shows: 2 confirmed pre-dated = met', CHECKS.shows_performed(baseCtx({
    showsConfirmed: [{ isPaid: false, isHeadline: false, preDated: true }, { isPaid: false, isHeadline: false, preDated: true }],
  }), { min: 2 }));
  ok('shows: confirmed but NOT pre-dated never count (no backdating gigs)', CHECKS.shows_performed(baseCtx({
    showsConfirmed: [{ isPaid: false, isHeadline: false, preDated: false }, { isPaid: false, isHeadline: false, preDated: false }],
  }), { min: 2 }) === false);
  ok('5 shows w/ 1 paid = s4 met', CHECKS.shows_performed(baseCtx({
    showsConfirmed: Array.from({ length: 5 }, (_, i) => ({ isPaid: i === 0, isHeadline: false, preDated: true })),
  }), { min: 5, paidMin: 1 }));
  ok('5 shows, zero paid = s4 NOT met', CHECKS.shows_performed(baseCtx({
    showsConfirmed: Array.from({ length: 5 }, () => ({ isPaid: false, isHeadline: false, preDated: true })),
  }), { min: 5, paidMin: 1 }) === false);

  console.log('\n— Anti-farm: self-feedback excluded from the s2_share gate —');
  // shareFeedbackCount in buildContext counts DISTINCT non-owner emails; here
  // we assert the CHECK still keys off that pre-counted value (3 distinct).
  ok('3 distinct non-owner feedback = met', CHECKS.share_feedback(baseCtx({ shareFeedbackCount: 3 }), { min: 3 }));
  ok('2 distinct (one was self/dup) = NOT met', CHECKS.share_feedback(baseCtx({ shareFeedbackCount: 2 }), { min: 3 }) === false);

  console.log('\n— Collab gate reachable via featured_artists (was unreachable) —');
  ok('collab via featured artists', CHECKS.collab_release(baseCtx({ hasCollabRelease: true }), {}));
  ok('no collab = not met', CHECKS.collab_release(baseCtx({ hasCollabRelease: false }), {}) === false);

  console.log('\n— Share links: revocation/expiry kill playback —');
  ok('live link valid', shareLinkInvalidReason({ revoked: false, expires_at: null }) === null);
  ok('revoked → dead', shareLinkInvalidReason({ revoked: true, expires_at: null }) === 'revoked');
  ok('expired → dead', shareLinkInvalidReason({ revoked: false, expires_at: '2020-01-01T00:00:00Z' }) === 'expired');
  ok('future expiry → valid', shareLinkInvalidReason({ revoked: false, expires_at: '2099-01-01T00:00:00Z' }) === null);

  console.log('\n— Live: catalog seeded + backfill loss-free —');
  const { data: catalog } = await db.from('career_stage_requirements').select('key,stage,verify_type').eq('active', true);
  ok('30 requirements live', (catalog ?? []).length === 30, String((catalog ?? []).length));
  ok('catalog keys match the code registry exactly',
    new Set((catalog ?? []).map((r: any) => r.key)).size === 30
    && (catalog ?? []).every((r: any) => allKeys.includes(r.key)));

  // Loss-free: every user whose roadmap_progress covers a playbook set has the row.
  const { data: readers } = await db.from('profiles').select('user_id,roadmap_progress').not('roadmap_progress', 'is', null);
  let expected = 0, found = 0;
  for (const p of (readers ?? []) as any[]) {
    const read = (p.roadmap_progress ?? {}) as Record<string, boolean>;
    for (const req of REQUIREMENTS.filter((r) => r.playbook)) {
      if (!req.playbook!.items.every((i) => read[`${req.playbook!.section}-${i}`] === true)) continue;
      expected++;
      const { data: row } = await db.from('requirement_progress').select('status')
        .eq('user_id', p.user_id).eq('requirement_key', req.key).maybeSingle();
      if ((row as any)?.status === 'complete') found++;
    }
  }
  ok(`backfill loss-free (${found}/${expected} covered sets have progress rows)`, expected === found);

  console.log('\n— Live: evaluation for an unknown user writes NOTHING —');
  const ghost = crypto.randomUUID();
  const res = await evaluateGates(db as never, ghost);
  ok('ghost user: zero completions, stage 0, no crash',
    res.newlyCompleted.length === 0 && res.stage === 0 && !res.stageUp);
  const { count: ghostRows } = await db.from('requirement_progress')
    .select('requirement_key', { count: 'exact', head: true }).eq('user_id', ghost);
  ok('ghost user: zero rows persisted', (ghostRows ?? 0) === 0);

  console.log('\n— Consistency: achievements ⇔ gates share one write path —');
  // Every stage achievement held by a user must match their computed stage.
  const { data: stageAch } = await db.from('artist_achievements')
    .select('user_id,achievement_key').in('achievement_key', Object.values(CAREER_ACHIEVEMENTS.stages));
  let consistent = true;
  for (const a of (stageAch ?? []) as any[]) {
    const { data: prog } = await db.from('requirement_progress')
      .select('requirement_key,status').eq('user_id', a.user_id).eq('status', 'complete');
    const done = new Set(((prog ?? []) as any[]).map((p) => p.requirement_key));
    const achStage = Number(Object.entries(CAREER_ACHIEVEMENTS.stages).find(([, k]) => k === a.achievement_key)?.[0]);
    if (computeStage(done) < achStage) consistent = false;
  }
  ok('no stage achievement exists without its gates complete', consistent);

  // 4-week streak helper sanity.
  ok('daysBetweenIso basic', daysBetweenIso('2026-06-01', '2026-06-08') === 7);
}

main()
  .catch((e) => { console.error('ERROR:', e); fail++; })
  .finally(() => {
    console.log(`\n${fail === 0 ? '✅ CAREER PATH: ALL PASS' : `❌ ${fail} FAILED: ${failures.join(', ')}`}  (${pass} passed)\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
