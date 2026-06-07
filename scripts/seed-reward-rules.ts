// scripts/seed-reward-rules.ts — upsert the canonical REWARD_RULES into reward_rules
// (idempotent, by rule_key). Run after adding/editing rules in lib/rewards.ts.
import { createServiceClient } from '../lib/supabase/server';
import { seedRewardRules } from '../lib/rewards-server';

async function main() {
  const db = createServiceClient();
  const { upserted } = await seedRewardRules(db);
  console.log(`✅ seedRewardRules upserted ${upserted} rules`);
  const { data } = await db.from('reward_rules')
    .select('rule_key, reward_type, threshold, reward_value, window_kind')
    .eq('counter', 'beat_spend').order('sort_order');
  console.log('beat_spend rules now in DB:');
  for (const r of data ?? []) console.log('  ', JSON.stringify(r));
}
main().catch((e) => { console.error(e); process.exit(1); });
