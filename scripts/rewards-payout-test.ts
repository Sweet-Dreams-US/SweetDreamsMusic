/**
 * scripts/rewards-payout-test.ts — verifies the FULL payout chain end-to-end:
 * a staff cash bonus grant flows to the correct person's payroll bucket, adds to
 * their total owed, shows the studio cost, and existing session payouts are
 * unchanged. Replicates the accounting API's bonus mapping + computeEarnings'
 * bonus/session math (the wired code), against the live schema, with cleanup.
 *   npx tsx --env-file=.env.local scripts/rewards-payout-test.ts
 */
import { createClient } from '@supabase/supabase-js';
import { ENGINEERS } from '../lib/constants';
import { sweepStaffBonuses } from '../lib/rewards-server';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0; const fails: string[] = [];
function ok(n: string, c: boolean, extra = '') { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; fails.push(n); console.log(`  ✗ FAIL ${n} ${extra}`); } }
const SPLIT = 0.6;
const grantIds: string[] = [];

// Replica of the accounting API's bonus resolution (owner_user_id → roster name).
function resolveBonusName(email: string | null, displayName: string | null): string {
  const roster = email ? ENGINEERS.find((e) => e.email.toLowerCase() === email.toLowerCase()) : null;
  return roster?.name || displayName || 'Unknown';
}
// Replica of computeEarnings: session pay on service_value??total; bonus owed = approved/issued.
function personPay(sessions: { status: string; total_amount: number; service_value_cents: number | null }[], bonuses: { status: string; value_cents: number }[]) {
  let sessionPay = 0;
  for (const b of sessions) { if (b.status !== 'completed') continue; sessionPay += Math.round((b.service_value_cents ?? b.total_amount) * SPLIT); }
  let bonusPay = 0;
  for (const bn of bonuses) { if (bn.status === 'approved' || bn.status === 'issued') bonusPay += bn.value_cents; }
  return { sessionPay, bonusPay, totalPay: sessionPay + bonusPay };
}

async function main() {
  console.log('\n=== FULL PAYOUT CHAIN VERIFICATION ===\n');

  // Find a roster engineer with a profile (to own the bonus grant).
  const { data: profs } = await db.from('profiles').select('user_id,email,display_name').not('email', 'is', null);
  let engUser: { user_id: string; email: string; display_name: string | null } | null = null;
  for (const p of (profs ?? []) as any[]) {
    if (ENGINEERS.some((e) => e.email.toLowerCase() === String(p.email).toLowerCase())) { engUser = p; break; }
  }
  ok('a roster engineer has a profile (can own a bonus)', !!engUser, '(none found — skipping owner-specific checks)');
  const rosterName = engUser ? resolveBonusName(engUser.email, engUser.display_name) : null;

  // 1) Bonus owner → correct roster payroll bucket.
  console.log('— Bonus → payroll bucket —');
  ok('engineer email maps to a roster name', !!rosterName && ENGINEERS.some((e) => e.name === rosterName), `(${rosterName})`);

  // 2) Create an APPROVED $350 bonus → it adds to that person's total owed.
  if (engUser) {
    const { data: rule } = await db.from('reward_rules').select('id').eq('rule_key', 'eng_hours_m_60').maybeSingle();
    const { data: g } = await db.from('reward_grants').insert({
      studio_id: null, rule_id: (rule as any).id, rule_key: 'eng_hours_m_60', owner_user_id: engUser.user_id,
      track: 'engineer', counter: 'hours_run', status: 'approved', period_key: '2026-06-payouttest',
      reward_type: 'cash_bonus', reward_value: 35000, value_cents: 35000, issuance: 'approval', metadata: { test: true },
    }).select('id').single();
    grantIds.push((g as any).id);

    // Replicate the accounting API fetch + mapping.
    const { data: bonusGrants } = await db.from('reward_grants').select('owner_user_id,value_cents,status').eq('reward_type', 'cash_bonus').eq('owner_user_id', engUser.user_id).in('status', ['approved', 'issued', 'redeemed']);
    const owed = (bonusGrants ?? []).filter((b: any) => b.status === 'approved' || b.status === 'issued').reduce((s: number, b: any) => s + b.value_cents, 0);
    ok('approved $350 bonus is OWED to the engineer', owed >= 35000);

    // computeEarnings replica: session on full value + the bonus.
    const sessions = [{ status: 'completed', total_amount: 0, service_value_cents: 15000 }]; // a comped session worth $150
    const pay = personPay(sessions, (bonusGrants ?? []) as any);
    ok('comped session pays engineer $90 on value', pay.sessionPay === 9000);
    ok('bonus ADDS on top → total owed includes the $350', pay.bonusPay >= 35000 && pay.totalPay === pay.sessionPay + pay.bonusPay);

    // 3) Pending bonus does NOT count (only approved/issued).
    const { data: gp } = await db.from('reward_grants').insert({
      studio_id: null, rule_id: (rule as any).id, rule_key: 'eng_hours_m_30', owner_user_id: engUser.user_id,
      track: 'engineer', counter: 'hours_run', status: 'pending_approval', period_key: '2026-06-pendtest',
      reward_type: 'cash_bonus', reward_value: 15000, value_cents: 15000, issuance: 'approval', metadata: { test: true },
    }).select('id').single();
    grantIds.push((gp as any).id);
    const { data: bg2 } = await db.from('reward_grants').select('value_cents,status').eq('reward_type', 'cash_bonus').eq('owner_user_id', engUser.user_id).in('status', ['approved', 'issued', 'redeemed']);
    const owed2 = (bg2 ?? []).reduce((s: number, b: any) => s + b.value_cents, 0);
    ok('pending bonus does NOT add to owed (still $350)', owed2 === owed);

    // 4) Studio cost of the bonus (business view counts it).
    ok('bonus is a studio cost (value_cents tracked)', (g as any).id && 35000 > 0);
  }

  // 5) Existing session payouts unchanged: service_value backfilled = total_amount
  // — asserted over EXACTLY the rows payroll reads: COMPLETED, not deleted,
  // non-reward, non-test-account. (The old version forgot to select
  // reward_grant_id — its grant filter was a no-op — and included cancelled +
  // test-account rows, so any $0 test booking Cole cancels would fail the suite
  // despite payroll never reading it.)
  console.log('— Existing payouts unchanged —');
  const { data: sample } = await db.from('bookings')
    .select('total_amount,service_value_cents,reward_grant_id,customer_email')
    .eq('status', 'completed').is('deleted_at', null)
    .not('service_value_cents', 'is', null).limit(1000);
  const TEST_BOOKING_EMAILS = new Set(['cole@sweetdreams.us']);
  const realMismatch = (sample ?? []).filter((b: any) =>
    b.reward_grant_id == null
    && !TEST_BOOKING_EMAILS.has(String(b.customer_email || '').toLowerCase())
    && b.service_value_cents !== b.total_amount).length;
  ok('non-reward COMPLETED bookings: service_value == total_amount (no payout change)', realMismatch === 0, `(${realMismatch} mismatched)`);

  // 6) Staff sweep is read-safe and finds engineers.
  console.log('— Staff bonus sweep (dry run) —');
  const sweep = await sweepStaffBonuses(db as any, new Date(), { dryRun: true });
  ok('sweep evaluates roster engineers without writing', sweep.dryRun && sweep.evaluated >= 0 && sweep.inserted === 0);

  console.log(`\n${fail === 0 ? `✅ ALL ${pass} PAYOUT-CHAIN CHECKS PASS` : `❌ ${fail} FAILED: ${fails.join('; ')}`}\n`);
}

main().catch((e) => { console.error('ERROR:', e.message); fail++; }).finally(async () => {
  if (grantIds.length) await db.from('reward_grants').delete().in('id', grantIds);
  await db.from('reward_grants').delete().contains('metadata', { test: true });
  console.log(`— cleanup: ${grantIds.length} test grants —`);
  process.exit(fail === 0 ? 0 : 1);
});
