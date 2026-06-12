/**
 * scripts/rewards-gap-test.ts — tests the gap-closure logic against the LIVE schema:
 * best-of discount resolution, single-use grant redemption, cancel restoration (credit
 * + discount, both idempotent), and reward→credit linkage. Isolated test owner; total
 * cleanup in finally.  npx tsx --env-file=.env.local scripts/rewards-gap-test.ts
 */
import { createClient } from '@supabase/supabase-js';
import { bestStudioDiscountForOwner, markGrantRedeemed, restoreRewardsOnCancel, issueGrant } from '../lib/rewards-issue';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0; const fails: string[] = [];
function ok(n: string, c: boolean, extra = '') { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; fails.push(n); console.log(`  ✗ FAIL ${n} ${extra}`); } }

const grantIds: string[] = [], creditIds: string[] = [], bookingIds: string[] = [], redemptionIds: string[] = [];

async function ruleId(db2: any, key: string): Promise<string> {
  const { data } = await db2.from('reward_rules').select('id').eq('rule_key', key).maybeSingle();
  return data.id;
}
async function addGrant(g: any): Promise<string> {
  const { data, error } = await db.from('reward_grants').insert({ studio_id: null, track: 'customer', counter: 'studio_hours', period_key: `gap-${Math.round(performance.now())}-${Math.random().toString(36).slice(2, 7)}`, reward_type: 'spend_discount_pct', reward_value: 5, issuance: 'auto', status: 'issued', metadata: { test: true }, ...g }).select('id').single();
  if (error) throw new Error('addGrant: ' + error.message);
  grantIds.push(data.id); return data.id;
}

async function main() {
  console.log('\n=== REWARDS GAP-CLOSURE TEST ===\n');
  const { data: prof } = await db.from('profiles').select('user_id').ilike('email', 'cole@sweetdreams.us').maybeSingle();
  const U = (prof as any)?.user_id; if (!U) throw new Error('no test user');
  const rk = await ruleId(db, 'cust_spend_5000'); // any real rule id for FK
  const rk2 = await ruleId(db, 'cust_spend_1000');
  const rkH = await ruleId(db, 'cust_sh_10');

  // A) best-of discount resolution
  console.log('— Discount resolution (best-of) —');
  await addGrant({ rule_id: rk2, rule_key: 'cust_spend_1000', owner_user_id: U, reward_type: 'spend_discount_pct', reward_value: 5, status: 'issued' });
  const g15 = await addGrant({ rule_id: rk, rule_key: 'cust_spend_5000', owner_user_id: U, reward_type: 'spend_discount_pct', reward_value: 15, status: 'issued' });
  let best = await bestStudioDiscountForOwner(db as any, U, null);
  ok('returns the highest pct (15) + a grant id', best?.pct === 15 && !!best?.grantId);
  // expired discount excluded
  const gExp = await addGrant({ rule_id: rk, rule_key: 'cust_spend_5000', owner_user_id: U, reward_type: 'spend_discount_pct', reward_value: 30, status: 'issued', expires_at: new Date(Date.now() - 86400000).toISOString() });
  best = await bestStudioDiscountForOwner(db as any, U, null);
  ok('expired 30% excluded (still 15)', best?.pct === 15);
  void gExp;

  // B) single-use redemption
  console.log('— Single-use grant redemption —');
  await markGrantRedeemed(db as any, g15, undefined);
  const { data: g15after } = await db.from('reward_grants').select('status').eq('id', g15).single();
  ok('grant marked redeemed', (g15after as any).status === 'redeemed');
  best = await bestStudioDiscountForOwner(db as any, U, null);
  ok('redeemed grant no longer offered (falls to 5%)', best?.pct === 5);
  await markGrantRedeemed(db as any, g15, undefined); // idempotent
  const { data: g15again } = await db.from('reward_grants').select('status').eq('id', g15).single();
  ok('re-redeem is a no-op (still redeemed)', (g15again as any).status === 'redeemed');

  // C) restore on cancel — CREDIT-funded
  console.log('— Cancel restoration: credit-funded —');
  const { data: sc } = await db.from('studio_credits').insert({ user_id: U, hours_granted: 5, hours_used: 2, cost_basis_cents: 0 }).select('id').single();
  creditIds.push((sc as any).id);
  const { data: bk } = await db.from('bookings').insert({ customer_name: 'GapTest', customer_email: 'cole@sweetdreams.us', start_time: '2026-09-01 18:00:00+00', end_time: '2026-09-01 20:00:00+00', duration: 2, room: 'studio_b', status: 'confirmed', total_amount: 0, deposit_amount: 0, remainder_amount: 0, service_value_cents: 10000, admin_notes: `credit_redemption:${(sc as any).id}` }).select('id').single();
  bookingIds.push((bk as any).id);
  const { data: red } = await db.from('studio_credit_redemptions').insert({ credit_id: (sc as any).id, studio_booking_id: (bk as any).id, hours_redeemed: 2, redeemed_by: U }).select('id').single();
  redemptionIds.push((red as any).id);
  const r1 = await restoreRewardsOnCancel(db as any, (bk as any).id);
  ok('restores 2 hours on cancel', r1.hoursRestored === 2);
  const { data: scAfter } = await db.from('studio_credits').select('hours_used').eq('id', (sc as any).id).single();
  ok('hours_used decremented 2 → 0', Number((scAfter as any).hours_used) === 0);
  const { data: redAfter } = await db.from('studio_credit_redemptions').select('id').eq('id', (red as any).id).maybeSingle();
  ok('redemption row deleted', !redAfter);
  const r2 = await restoreRewardsOnCancel(db as any, (bk as any).id);
  ok('restore is idempotent (2nd call restores 0)', r2.hoursRestored === 0);

  // D) restore on cancel — DISCOUNT-funded
  console.log('— Cancel restoration: discount-funded —');
  const gd = await addGrant({ rule_id: rk, rule_key: 'cust_spend_5000', owner_user_id: U, reward_type: 'spend_discount_pct', reward_value: 15, status: 'redeemed' });
  const { data: bk2 } = await db.from('bookings').insert({ customer_name: 'GapTest2', customer_email: 'cole@sweetdreams.us', start_time: '2026-09-02 18:00:00+00', end_time: '2026-09-02 21:00:00+00', duration: 3, room: 'studio_b', status: 'confirmed', total_amount: 12750, deposit_amount: 6375, remainder_amount: 6375, service_value_cents: 15000, reward_grant_id: gd }).select('id').single();
  bookingIds.push((bk2 as any).id);
  const r3 = await restoreRewardsOnCancel(db as any, (bk2 as any).id);
  ok('discount grant restored to reusable', r3.grantRestored === true);
  const { data: gdAfter } = await db.from('reward_grants').select('status').eq('id', gd).single();
  ok('grant back to issued (not burned by cancel)', (gdAfter as any).status === 'issued');

  // E) reward → credit linkage lookup (issued_ref)
  console.log('— Reward → credit linkage —');
  const gh = await addGrant({ rule_id: rkH, rule_key: 'cust_sh_10', owner_user_id: U, reward_type: 'free_hours', reward_value: 1, status: 'approved' });
  const iss = await issueGrant(db as any, gh);
  if (iss.issued_ref) creditIds.push(iss.issued_ref.split(':')[1]);
  const { data: linked } = await db.from('reward_grants').select('id').eq('issued_ref', iss.issued_ref!).maybeSingle();
  ok('a reward-issued credit is findable by issued_ref (booking can link it)', (linked as any)?.id === gh);

  console.log(`\n${fail === 0 ? `✅ ALL ${pass} GAP CHECKS PASS` : `❌ ${fail} FAILED: ${fails.join('; ')}`}\n`);
}

async function cleanup() {
  for (const id of redemptionIds) await db.from('studio_credit_redemptions').delete().eq('id', id);
  for (const id of bookingIds) await db.from('bookings').delete().eq('id', id);
  for (const id of creditIds) await db.from('studio_credits').delete().eq('id', id);
  if (grantIds.length) await db.from('reward_grants').delete().in('id', grantIds);
  await db.from('reward_grants').delete().contains('metadata', { test: true });
  await db.from('bookings').delete().eq('customer_email', 'cole@sweetdreams.us').like('customer_name', 'GapTest%');
  console.log(`— cleanup: ${grantIds.length} grants, ${creditIds.length} credits, ${bookingIds.length} bookings, ${redemptionIds.length} redemptions —`);
}

main().catch((e) => { console.error('ERROR:', e.message); fail++; }).finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1); });
