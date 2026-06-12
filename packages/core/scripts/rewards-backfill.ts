/**
 * scripts/rewards-backfill.ts
 *
 * Phase 1 preview/runner for the rewards engine. Seeds the reward_rules from the
 * canonical lib/rewards.ts ruleset, then evaluates every current customer + band
 * against this calendar year's loyalty ladders and reports what they'd be granted.
 *
 * REQUIRES migration 066 (reward_rules + reward_grants) to be applied first —
 * to a Supabase branch for safe preview, or to prod when you're ready.
 *
 * DRY RUN (default — reads only, writes nothing):
 *   npx tsx --env-file=.env.local scripts/rewards-backfill.ts
 *
 * APPLY (seeds rules + writes reward_grants):
 *   npx tsx --env-file=.env.local scripts/rewards-backfill.ts --apply
 *
 * Flags:
 *   --apply       actually seed rules + write grants (otherwise dry run)
 *   --seed-only   just upsert reward_rules, skip the backfill
 */

import { createClient } from '@supabase/supabase-js';
import { seedRewardRules, backfillCustomersAndBands } from '../lib/rewards-server';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const SEED_ONLY = process.argv.includes('--seed-only');

async function main() {
  const db = createClient(URL!, KEY!);
  const now = new Date();

  console.log(`\n=== Rewards backfill (${APPLY ? 'APPLY — writing' : 'DRY RUN — reading only'}) ===\n`);

  if (APPLY) {
    const seeded = await seedRewardRules(db);
    console.log(`Seeded reward_rules: ${seeded.upserted} rules upserted.`);
  } else {
    console.log('(dry run — reward_rules NOT seeded; run with --apply to seed + write)');
  }

  if (SEED_ONLY) { console.log('\n--seed-only: done.'); return; }

  // The backfill needs the rules present to map rule_key -> id when persisting.
  // In dry run we still evaluate counters (no rule ids needed) and report.
  const report = await backfillCustomersAndBands(db, now, { dryRun: !APPLY });

  console.log('\n--- Report ---');
  console.log(`Customers evaluated: ${report.customers}`);
  console.log(`Bands evaluated:     ${report.bands}`);
  console.log(`Grants found:        ${report.grantsFound}`);
  console.log(`Grants inserted:     ${report.grantsInserted}${APPLY ? '' : ' (dry run)'}`);
  console.log('\nSample (first 20):');
  for (const s of report.sample) {
    console.log(`  • ${s.owner.padEnd(34)} ${String(s.counter_value).padStart(8)}  ${s.period}  ${s.label}`);
  }

  console.log('\n--- Past-tier rewards FORGIVEN (progress-only baseline) ---');
  const types = Object.entries(report.exposure.byType).sort((a, b) => b[1].estCents - a[1].estCents);
  for (const [type, { count, estCents }] of types) {
    console.log(`  ${type.padEnd(22)} x${String(count).padStart(3)}   est. $${(estCents / 100).toFixed(2)}`);
  }
  console.log(`  ${'TOTAL retail NOT given'.padEnd(22)}        $${(report.exposure.totalEstCents / 100).toFixed(2)}`);
  console.log('\n  Progress-only: these already-reached tiers are recorded as BASELINE (kept as');
  console.log('  progress, NOT issued — the old 3hr→free-short deal already gave that value).');
  console.log('  Customers earn rewards only on tiers crossed AFTER launch.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
