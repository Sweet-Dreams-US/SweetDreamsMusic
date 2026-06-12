/**
 * scripts/seed-site-content.ts — populate site_content from the registry defaults.
 *   npx tsx --env-file=.env.local scripts/seed-site-content.ts
 *   npx tsx --env-file=.env.local scripts/seed-site-content.ts --overwrite
 *
 * Idempotent: default mode SKIPS keys that already exist (never clobbers an
 * admin's edits). Inlines the upsert (rather than importing the server module)
 * so it doesn't pull next/cache into the tsx runtime. Seeded values == current
 * site copy, so pages render byte-identical after seeding.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { CONTENT_REGISTRY } from '../lib/site-content';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const OVERWRITE = process.argv.includes('--overwrite');

async function main() {
  const { data: loc } = await db.from('studios').select('id').eq('slug', 'sweet-dreams').maybeSingle();
  const locationId = (loc as any)?.id ?? null;
  let upserted = 0, skipped = 0;
  for (const f of CONTENT_REGISTRY) {
    if (!OVERWRITE) {
      const { data: existing } = await db.from('site_content').select('key').eq('key', f.key).maybeSingle();
      if (existing) { skipped++; continue; }
    }
    const { error } = await db.from('site_content').upsert({
      key: f.key, value: { v: f.default }, group_name: f.group, label: f.label, kind: f.kind,
      location_id: locationId, updated_by: 'seed',
    } as any, { onConflict: 'key' });
    if (error) { console.error(`  ✗ ${f.key}: ${error.message}`); continue; }
    upserted++;
  }
  console.log(`\n✅ site_content seeded: ${upserted} upserted, ${skipped} skipped (existing). ${CONTENT_REGISTRY.length} registry keys.\n`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
