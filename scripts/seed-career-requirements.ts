// scripts/seed-career-requirements.ts — upsert the Stage 1-5 requirement
// catalog from lib/career.ts REQUIREMENTS (idempotent; keys are stable), then
// LOSS-FREE BACKFILL: users whose existing profiles.roadmap_progress JSONB
// already covers a playbook requirement's item set get the requirement_progress
// row. Run: npx tsx --env-file=.env.local scripts/seed-career-requirements.ts

import { createClient } from '@supabase/supabase-js';
import { REQUIREMENTS } from '../lib/career';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing env'); process.exit(1); }
const db = createClient(URL, KEY);

async function main() {
  // 1. Seed the catalog.
  const rows = REQUIREMENTS.map((r) => ({
    stage: r.stage, key: r.key, title: r.title, description: r.description,
    verify_type: r.verifyType,
    rule: r.playbook ? { playbook: r.playbook } : (r.rule ?? {}),
    confirm_fields: r.confirmFields ?? null,
    playbook_section: r.playbook?.section ?? null,
    xp_award: r.xp, sort: r.sort, active: true,
  }));
  const { error } = await db.from('career_stage_requirements')
    .upsert(rows as never[], { onConflict: 'key' });
  if (error) { console.error('seed failed:', error.message); process.exit(1); }
  console.log(`seeded ${rows.length} requirements`);

  // 2. Backfill playbook progress from existing roadmap reads (loss-free).
  const { data: readers } = await db.from('profiles')
    .select('user_id,roadmap_progress')
    .not('roadmap_progress', 'is', null);
  let backfilled = 0;
  for (const p of (readers ?? []) as any[]) {
    const read = (p.roadmap_progress ?? {}) as Record<string, boolean>;
    if (!p.user_id || Object.keys(read).length === 0) continue;
    for (const req of REQUIREMENTS.filter((r) => r.playbook)) {
      const covered = req.playbook!.items.every((i) => read[`${req.playbook!.section}-${i}`] === true);
      if (!covered) continue;
      const { error: e } = await db.from('requirement_progress').upsert({
        user_id: p.user_id, requirement_key: req.key, status: 'complete',
        completed_at: new Date().toISOString(),
        evidence: { backfilled_from: 'roadmap_progress', items: req.playbook!.items.map((i) => `${req.playbook!.section}-${i}`) },
      } as never, { onConflict: 'user_id,requirement_key', ignoreDuplicates: true });
      if (!e) backfilled++;
    }
  }
  console.log(`backfilled ${backfilled} playbook requirement rows`);

  const { count } = await db.from('career_stage_requirements').select('id', { count: 'exact', head: true });
  console.log(`catalog rows in DB: ${count}`);
}
main();
