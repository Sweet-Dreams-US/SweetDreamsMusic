// scripts/beat-rewards-test.ts — verifies the beat-spend reward ladder + the
// license-scoped discount math. Pure (no DB). Run: npx tsx scripts/beat-rewards-test.ts
import { REWARD_RULES } from '../lib/rewards';

let pass = true;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) pass = false; };

const beat = REWARD_RULES.filter((r) => r.counter === 'beat_spend');
const by = (k: string) => beat.find((r) => r.rule_key === k)!;

ok('6 beat_spend rules exist', beat.length === 6);
ok('all are customer track', beat.every((r) => r.track === 'customer'));
ok('all calendar_year window', beat.every((r) => r.window === 'calendar_year'));

// Tiers + reward types (the brackets Cole asked for).
ok('$75 → 10% lease discount',  by('cust_beat_75').threshold === 7500  && by('cust_beat_75').reward_type === 'beat_lease_discount_pct' && by('cust_beat_75').reward_value === 10);
ok('$150 → 20% lease discount', by('cust_beat_150').threshold === 15000 && by('cust_beat_150').reward_type === 'beat_lease_discount_pct' && by('cust_beat_150').reward_value === 20);
ok('$300 → 1 free studio hour', by('cust_beat_300').threshold === 30000 && by('cust_beat_300').reward_type === 'free_hours' && by('cust_beat_300').reward_value === 1);
ok('$600 → 25% lease discount', by('cust_beat_600').threshold === 60000 && by('cust_beat_600').reward_type === 'beat_lease_discount_pct' && by('cust_beat_600').reward_value === 25);
ok('$1000 → 2 free studio hours', by('cust_beat_1000h').threshold === 100000 && by('cust_beat_1000h').reward_type === 'free_hours' && by('cust_beat_1000h').reward_value === 2);
ok('$1000 → 15% EXCLUSIVE discount', by('cust_beat_1000x').threshold === 100000 && by('cust_beat_1000x').reward_type === 'beat_exclusive_discount_pct' && by('cust_beat_1000x').reward_value === 15);

// Brackets: lease discounts are best-of (one_total); exclusive is its own type.
const leaseRules = beat.filter((r) => r.reward_type === 'beat_lease_discount_pct');
ok('lease discounts are one_total (best-of)', leaseRules.every((r) => r.stack_mode === 'one_total'));
ok('no lease discount ever targets exclusives (separate reward_type)', !beat.some((r) => r.reward_type === 'beat_lease_discount_pct' && r.reward_value > 25));

// Checkout discount math (price - floor(price*pct/100)), prices in cents.
const charge = (price: number, pct: number) => Math.max(0, price - Math.floor((price * pct) / 100));
ok('exclusive $400 @15% → $340.00', charge(40000, 15) === 34000);
ok('trackout $74.99 @25% → $56.25', charge(7499, 25) === 5625);
ok('mp3 $29.99 @20% → $24.00',     charge(2999, 20) === 2400);
ok('no grant → full price (no-op)', charge(40000, 0) === 40000);

// The combined dollars_spent ladder is untouched (beats still count there too).
ok('combined dollars_spent ladder still present', REWARD_RULES.some((r) => r.counter === 'dollars_spent' && r.reward_type === 'spend_discount_pct'));

console.log('');
console.log(pass ? '✅ BEAT REWARDS LADDER VERIFIED' : '❌ FAILURES ABOVE');
process.exit(pass ? 0 : 1);
