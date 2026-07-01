/**
 * scripts/backfill-social-links-to-connections.ts — finish the social-links unification.
 *   npx tsx --env-file=.env.local scripts/backfill-social-links-to-connections.ts          # DRY RUN (report only)
 *   npx tsx --env-file=.env.local scripts/backfill-social-links-to-connections.ts --write  # apply
 *
 * Copies every legacy profiles.social_links entry into platform_connections (the
 * canonical, reversible source the metrics tracker + social links both use) for any
 * platform NOT already connected. Reuses backfillSocialLinksFromProfile, so it is:
 *   - IDEMPOTENT + no-overwrite (already-connected platforms are skipped),
 *   - safe on junk (unparseable spotify/youtube links are skipped, not stored).
 *
 * Run this on live BEFORE deploying the code that drops the legacy read-fallback in
 * getUnifiedSocialLinks — that way no artist's links vanish in the switch-over.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { backfillSocialLinksFromProfile } from '../lib/social-links-server';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing env. Run with --env-file=.env.local'); process.exit(1); }
const db = createClient(URL, KEY);
const WRITE = process.argv.includes('--write');

async function main() {
  const { data: profiles, error } = await db
    .from('profiles')
    .select('user_id, display_name, social_links')
    .not('social_links', 'is', null);
  if (error) { console.error(error); process.exit(1); }

  const targets = (profiles ?? []).filter(
    (p: any) => p.social_links && typeof p.social_links === 'object' && Object.keys(p.social_links).length > 0,
  );
  console.log(`${targets.length} profile(s) with a legacy social_links blob.\n`);

  let totalAdded = 0;
  for (const p of targets as any[]) {
    if (WRITE) {
      const added = await backfillSocialLinksFromProfile(db as any, p.user_id);
      totalAdded += added;
      console.log(`  ${added > 0 ? `+${added}` : '  ·'}  ${p.display_name ?? '(no name)'} (${p.user_id})`);
    } else {
      console.log(`  [dry] ${p.display_name ?? '(no name)'}: {${Object.keys(p.social_links).join(', ')}}`);
    }
  }
  console.log(WRITE
    ? `\nDone. Added ${totalAdded} platform_connections row(s).`
    : `\nDry run only — re-run with --write to apply.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
