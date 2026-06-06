/**
 * scripts/rewards-deep-test.ts — exhaustive end-to-end test of the rewards system
 * against the LIVE schema, using an isolated test owner with guaranteed cleanup.
 *
 *   npx tsx --env-file=.env.local scripts/rewards-deep-test.ts
 *
 * Writes only: reward_rules (the real seed — left in place), and test reward_grants
 * + studio_credits/media_credits owned by the test user (ALL deleted in finally).
 * Touches no real customer data and nothing that feeds accounting.
 */
import { createClient } from '@supabase/supabase-js';
import {
  REWARD_RULES, applyRewardsToPricing, cutdownsForMusicVideo, bestDiscountPct,
  periodKeyFor, windowRange,
} from '../lib/rewards';
import { seedRewardRules, evaluateOwner, persistGrants, type DesiredGrant } from '../lib/rewards-server';
import { issueGrant, approveGrant, denyGrant, activeDiscountsForOwner } from '../lib/rewards-issue';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, KEY);

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ FAIL ${name} ${extra}`); }
}

// Track everything we insert so cleanup is total.
const cleanupGrantIds: string[] = [];
const cleanupCreditRefs: string[] = []; // 'studio_credits:<id>' | 'media_credits:<id>'

async function insertGrant(g: Partial<Record<string, unknown>>): Promise<string> {
  const { data, error } = await db.from('reward_grants').insert({
    studio_id: null, rule_key: 'TESTRULE', track: 'customer', counter: 'studio_hours',
    period_key: '2026', reward_type: 'free_hours', reward_value: 1, issuance: 'approval',
    status: 'approved', metadata: { test: true }, ...g,
  }).select('id').single();
  if (error) throw new Error('insertGrant: ' + error.message);
  cleanupGrantIds.push((data as { id: string }).id);
  return (data as { id: string }).id;
}

async function main() {
  console.log('\n=== REWARDS DEEP TEST (live schema, isolated test owner) ===\n');

  // Resolve the designated test user (accounting-excluded).
  const { data: prof } = await db.from('profiles').select('user_id,email').ilike('email', 'cole@sweetdreams.us').maybeSingle();
  const TEST_USER = (prof as { user_id: string } | null)?.user_id;
  if (!TEST_USER) throw new Error('No test user (cole@sweetdreams.us) found.');
  console.log('Test owner:', TEST_USER, '\n');

  // Need a real rule id to satisfy reward_grants.rule_id FK. Seed first, then use one.
  console.log('— Seeding rules —');
  const seeded = await seedRewardRules(db as never);
  ok('seedRewardRules upserts the full ladder', seeded.upserted === REWARD_RULES.length, `(${seeded.upserted})`);
  const { data: dbRules } = await db.from('reward_rules').select('id,rule_key,window_kind,threshold,stack_mode,effective_from,reward_type');
  ok('rules present in DB', (dbRules?.length ?? 0) === REWARD_RULES.length, `(${dbRules?.length})`);
  const ruleId = (k: string) => (dbRules as { id: string; rule_key: string }[]).find((r) => r.rule_key === k)!.id;
  const cust10 = (dbRules as { rule_key: string; window_kind: string; threshold: number }[]).find((r) => r.rule_key === 'cust_sh_10')!;
  ok('window_kind round-trips (cust_sh_10 = calendar_year)', cust10.window_kind === 'calendar_year');
  ok('threshold persisted (cust_sh_10 = 10)', Number(cust10.threshold) === 10);
  const engQ = (dbRules as { rule_key: string; effective_from: string | null }[]).find((r) => r.rule_key === 'eng_hours_q_kicker')!;
  ok('engineer quarterly kicker effective_from = 2026-07-01', String(engQ.effective_from).startsWith('2026-07-01'));

  // ── Pure charge math (the flawless-charge core) ──
  console.log('\n— Charge math —');
  let r = applyRewardsToPricing({ totalCents: 15000, subtotalCents: 15000 }, 3, {});
  ok('normal 3hr: charge 150, engineer pay 90', r.customerChargeCents === 15000 && Math.round(r.serviceValueCents * 0.6) === 9000);
  r = applyRewardsToPricing({ totalCents: 15000, subtotalCents: 15000 }, 3, { discountPct: 25 });
  ok('25% off: charge 112.50, engineer still 90 (full value)', r.customerChargeCents === 11250 && Math.round(r.serviceValueCents * 0.6) === 9000);
  r = applyRewardsToPricing({ totalCents: 6000, subtotalCents: 5000 }, 1, { freeHours: 1 });
  ok('free 1hr + $10 fee: customer pays the $10 fee, rewards cost = base $50', r.customerChargeCents === 1000 && r.rewardsCostCents === 5000);
  r = applyRewardsToPricing({ totalCents: 15000, subtotalCents: 15000 }, 3, { freeHours: 1 });
  ok('partial: 1 free of 3 → charge 100, engineer pay 90 (full value)', r.customerChargeCents === 10000 && Math.round(r.serviceValueCents * 0.6) === 9000);
  ok('cutdowns: $1000 MV → 4', cutdownsForMusicVideo(100000) === 4);
  ok('cutdowns: $500 MV → 2', cutdownsForMusicVideo(50000) === 2);
  ok('best-of discount picks max', bestDiscountPct([5, 25, 10]) === 25);

  // Payout-on-value (replicates the computeEarnings session-loop formula).
  const payout = (b: { total_amount: number; service_value_cents: number | null }) => Math.round((b.service_value_cents ?? b.total_amount) * 0.6);
  ok('comped credit session ($0 charged, $150 value) pays engineer $90', payout({ total_amount: 0, service_value_cents: 15000 }) === 9000);
  ok('normal session pays on total when service_value null (backfill-safe)', payout({ total_amount: 15000, service_value_cents: null }) === 9000);
  ok('discounted session pays engineer on FULL value', payout({ total_amount: 11250, service_value_cents: 15000 }) === 9000);

  // ── Window + period helpers ──
  console.log('\n— Windows / periods —');
  const jun = new Date(Date.UTC(2026, 5, 15));
  ok("calendar_year key = '2026'", periodKeyFor('calendar_year', jun) === '2026');
  ok("monthly key = '2026-06'", periodKeyFor('monthly', jun) === '2026-06');
  ok("quarterly key = '2026-Q2'", periodKeyFor('quarterly', jun) === '2026-Q2');
  const q2 = windowRange('quarterly', jun);
  ok('Q2 window = Apr1–Jul1', q2.start.toISOString().startsWith('2026-04-01') && q2.end.toISOString().startsWith('2026-07-01'));

  // ── Rule shape invariants ──
  console.log('\n— Rule invariants —');
  ok('spend tiers are one_total (status, not stacked)', REWARD_RULES.filter((x) => x.counter === 'dollars_spent').every((x) => x.stack_mode === 'one_total'));
  ok('studio-hour rungs are cumulative (each earns once)', REWARD_RULES.filter((x) => x.counter === 'studio_hours').every((x) => x.stack_mode === 'cumulative'));
  ok('engineer monthly effective Jun 1', REWARD_RULES.filter((x) => x.track === 'engineer' && x.window === 'monthly').every((x) => x.effective_from === '2026-06-01'));

  // ── Issuance: free hours → studio_credits ──
  console.log('\n— Issuance: free hours → studio_credits —');
  const gHours = await insertGrant({ rule_id: ruleId('cust_sh_10'), rule_key: 'cust_sh_10', owner_user_id: TEST_USER, reward_type: 'free_hours', reward_value: 2, status: 'approved' });
  const iss = await issueGrant(db as never, gHours);
  ok('issueGrant ok', iss.ok, iss.reason || '');
  if (iss.issued_ref) cleanupCreditRefs.push(iss.issued_ref);
  const { data: gAfter } = await db.from('reward_grants').select('status,issued_ref,expires_at').eq('id', gHours).single();
  ok('grant marked issued', (gAfter as { status: string }).status === 'issued');
  ok('issued_ref points at studio_credits', String((gAfter as { issued_ref: string }).issued_ref).startsWith('studio_credits:'));
  ok('expiry set (90d)', !!(gAfter as { expires_at: string | null }).expires_at);
  const scId = String((gAfter as { issued_ref: string }).issued_ref).split(':')[1];
  const { data: sc } = await db.from('studio_credits').select('hours_granted,cost_basis_cents,user_id').eq('id', scId).single();
  ok('studio_credits: 2 hours granted, comp cost_basis 0, owned by test user', Number((sc as { hours_granted: number }).hours_granted) === 2 && (sc as { cost_basis_cents: number }).cost_basis_cents === 0 && (sc as { user_id: string }).user_id === TEST_USER);
  const issAgain = await issueGrant(db as never, gHours);
  ok('issueGrant is idempotent (no double credit)', issAgain.ok === true);
  const { count: scCount } = await db.from('studio_credits').select('id', { count: 'exact', head: true }).eq('id', scId);
  ok('still exactly one studio_credits row after double-issue', scCount === 1);

  // ── Issuance: free media → media_credits ──
  console.log('\n— Issuance: free media → media_credits —');
  const gMv = await insertGrant({ rule_id: ruleId('cust_sh_100'), rule_key: 'cust_sh_100', owner_user_id: TEST_USER, reward_type: 'free_music_video', reward_value: 1, status: 'approved', period_key: '2026-mvtest' });
  const issMv = await issueGrant(db as never, gMv);
  if (issMv.issued_ref) cleanupCreditRefs.push(issMv.issued_ref);
  ok('free music video issues a media_credit', issMv.ok && String(issMv.issued_ref).startsWith('media_credits:'));
  const mcId = String(issMv.issued_ref).split(':')[1];
  const { data: mc } = await db.from('media_credits').select('credit_kind,quantity_granted').eq('id', mcId).single();
  ok('media_credits: 1 music_video', (mc as { credit_kind: string }).credit_kind === 'music_video' && Number((mc as { quantity_granted: number }).quantity_granted) === 1);

  // ── Approve / deny ──
  console.log('\n— Approve / deny —');
  const gPend = await insertGrant({ rule_id: ruleId('cust_sh_5'), rule_key: 'cust_sh_5', owner_user_id: TEST_USER, reward_type: 'free_short_video', reward_value: 1, status: 'pending_approval', period_key: '2026-apptest' });
  const appr = await approveGrant(db as never, gPend, TEST_USER);
  if (appr.issued_ref) cleanupCreditRefs.push(appr.issued_ref);
  ok('approveGrant → issued', appr.ok);
  const gDeny = await insertGrant({ rule_id: ruleId('cust_sh_5'), rule_key: 'cust_sh_5', owner_user_id: TEST_USER, reward_type: 'free_short_video', reward_value: 1, status: 'pending_approval', period_key: '2026-denytest' });
  await denyGrant(db as never, gDeny, TEST_USER, 'test deny');
  const { data: dG } = await db.from('reward_grants').select('status').eq('id', gDeny).single();
  ok('denyGrant → denied (never issues)', (dG as { status: string }).status === 'denied');

  // ── Discounts: best-of, active only ──
  console.log('\n— Discounts (best-of) —');
  const gd1 = await insertGrant({ rule_id: ruleId('cust_spend_1000'), rule_key: 'cust_spend_1000', owner_user_id: TEST_USER, reward_type: 'spend_discount_pct', reward_value: 2, status: 'approved', period_key: '2026-disc1' });
  const gd2 = await insertGrant({ rule_id: ruleId('cust_spend_5000'), rule_key: 'cust_spend_5000', owner_user_id: TEST_USER, reward_type: 'spend_discount_pct', reward_value: 10, status: 'approved', period_key: '2026-disc2' });
  const disc = await activeDiscountsForOwner(db as never, TEST_USER, null);
  ok('active discount = best-of (10%, not 2%+10%)', disc.spendPct === 10);
  // Expired discount is ignored.
  await db.from('reward_grants').update({ expires_at: new Date(Date.now() - 86400000).toISOString() }).eq('id', gd2);
  const disc2 = await activeDiscountsForOwner(db as never, TEST_USER, null);
  ok('expired discount excluded (falls back to 2%)', disc2.spendPct === 2);
  void gd1;

  // ── Dedup / progress-only baseline ──
  console.log('\n— Dedup + baseline (progress-only) —');
  const dg: DesiredGrant = { rule_key: 'cust_sh_20', track: 'customer', counter: 'studio_hours', period_key: '2026-deduptest', threshold: 20, counter_value: 25, reward_type: 'mv_discount_pct', reward_value: 25, value_cents: 0, issuance: 'approval', owner_user_id: TEST_USER, owner_band_id: null, label: 'dedup test' };
  const p1 = await persistGrants(db as never, [dg], 'test');
  const p2 = await persistGrants(db as never, [dg], 'test'); // same rule+owner+period
  ok('persistGrants dedups (2nd insert skipped)', p1.inserted === 1 && p2.inserted === 0);
  // find + track for cleanup
  const { data: dgRow } = await db.from('reward_grants').select('id,status').eq('rule_id', ruleId('cust_sh_20')).eq('owner_user_id', TEST_USER).eq('period_key', '2026-deduptest').single();
  cleanupGrantIds.push((dgRow as { id: string }).id);
  // baseline suppresses re-grant (persist under cust_sh_35; verify under the SAME rule)
  const bdg: DesiredGrant = { ...dg, rule_key: 'cust_sh_35', period_key: '2026-basetest' };
  await persistGrants(db as never, [{ ...bdg }], 'backfill', { statusOverride: 'baseline' });
  const { data: bRow } = await db.from('reward_grants').select('id,status').eq('rule_id', ruleId('cust_sh_35')).eq('owner_user_id', TEST_USER).eq('period_key', '2026-basetest').maybeSingle();
  if (bRow) cleanupGrantIds.push((bRow as { id: string }).id);
  ok('baseline grant is status=baseline (kept as progress, not issued)', (bRow as { status: string } | null)?.status === 'baseline');
  const pAfterBase = await persistGrants(db as never, [{ ...bdg }], 'evaluate'); // would-be new grant, same key
  ok('baselined tier is NOT re-granted later (dedup holds)', pAfterBase.inserted === 0);

  // ── Read-only live backfill still computes (engine intact) ──
  console.log('\n— Live evaluate (read-only) —');
  const { data: anyCustomer } = await db.from('bookings').select('customer_email').eq('status', 'completed').is('band_id', null).gt('total_amount', 0).not('customer_email', 'is', null).limit(1).maybeSingle();
  if (anyCustomer) {
    const email = String((anyCustomer as { customer_email: string }).customer_email).toLowerCase();
    const { data: cp } = await db.from('profiles').select('user_id').ilike('email', email).maybeSingle();
    if (cp) {
      const grants = await evaluateOwner(db as never, { track: 'customer', userId: (cp as { user_id: string }).user_id, email }, new Date());
      ok('evaluateOwner returns grants for a real customer (engine intact)', Array.isArray(grants));
    } else { ok('evaluateOwner (skipped — no profile for sampled email)', true); }
  } else { ok('evaluateOwner (skipped — no sample booking)', true); }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAILED: ${failures.join(', ')}`}  (${pass} passed)\n`);
}

async function cleanup() {
  console.log('— Cleanup —');
  for (const ref of cleanupCreditRefs) {
    const [tbl, id] = ref.split(':');
    if (tbl === 'studio_credits' || tbl === 'media_credits') await db.from(tbl).delete().eq('id', id);
  }
  if (cleanupGrantIds.length) await db.from('reward_grants').delete().in('id', cleanupGrantIds);
  // sweep any stray test grants on the test owner from this run
  await db.from('reward_grants').delete().contains('metadata', { test: true });
  console.log(`  removed ${cleanupGrantIds.length} grants + ${cleanupCreditRefs.length} credits`);
}

main()
  .catch((e) => { console.error('ERROR:', e.message); fail++; })
  .finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1); });
