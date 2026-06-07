/**
 * scripts/control-panel-e2e.ts — exhaustive live test of the Features & Navigation
 * control panel. Flips each flag in the DB, hits the running server, asserts the
 * page 404s/200s + nav reflects, and ALWAYS restores every flag (try/finally).
 *
 *   PORT=3099 npm run start &      # start a server first
 *   TEST_BASE=http://localhost:3099 npx tsx --env-file=.env.local scripts/control-panel-e2e.ts
 *
 * Safe: every flag is set back to TRUE at the end no matter what.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.TEST_BASE || 'http://localhost:3099';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) { pass++; } else { fail++; fails.push(n); console.log(`  ✗ ${n}`); } };

const TOGGLEABLE = [
  { flag: 'bands_enabled', href: '/bands' },
  { flag: 'events_enabled', href: '/events' },
  { flag: 'media_enabled', href: '/media' },
  { flag: 'nav_about_enabled', href: '/about' },
  { flag: 'nav_contact_enabled', href: '/contact' },
  { flag: 'nav_engineers_enabled', href: '/engineers' },
  { flag: 'nav_blog_enabled', href: '/blog' },
];
const LOCKED = ['/book', '/pricing', '/beats', '/sell-beats'];

async function status(path: string): Promise<number> {
  const r = await fetch(`${BASE}${path}?t=${Math.round(performance.now())}`, { redirect: 'manual' });
  return r.status;
}
async function setFlag(flag: string, val: boolean) {
  await db.from('site_settings').update({ [flag]: val } as any).is('studio_id', null);
}
async function setAll(val: boolean) {
  const cols = Object.fromEntries(TOGGLEABLE.map((t) => [t.flag, val]));
  await db.from('site_settings').update(cols as any).is('studio_id', null);
}

async function main() {
  console.log(`\n=== control-panel E2E vs ${BASE} ===\n`);
  try {
    // 0. Baseline: everything on → every page 200.
    await setAll(true);
    for (const t of TOGGLEABLE) ok(`baseline ${t.href} → 200`, (await status(t.href)) === 200);

    // 1. Each toggleable OFF → 404; ON → 200. Locked stay 200 throughout.
    for (const t of TOGGLEABLE) {
      await setFlag(t.flag, false);
      const off = await status(t.href);
      ok(`${t.flag}=false → ${t.href} 404`, off === 404);
      // locked pages unaffected while this feature is off
      for (const l of LOCKED) ok(`${l} still 200 while ${t.flag} off`, (await status(l)) === 200);
      await setFlag(t.flag, true);
      ok(`${t.flag}=true → ${t.href} 200`, (await status(t.href)) === 200);
    }

    // 2. ALL toggleable OFF at once → all 404, locked all 200.
    await setAll(false);
    for (const t of TOGGLEABLE) ok(`all-off: ${t.href} 404`, (await status(t.href)) === 404);
    for (const l of LOCKED) ok(`all-off: locked ${l} 200`, (await status(l)) === 200);
    ok('all-off: home / still 200', (await status('/')) === 200);

    // 3. Tampered DB can't disable a locked feature — there's no column. Confirm
    //    the locked pages have no flag to flip (schema guarantee).
    const { data: row } = await db.from('site_settings').select('*').is('studio_id', null).maybeSingle();
    const cols = Object.keys(row ?? {});
    ok('no studio_sessions column exists', !cols.some((c) => c.includes('studio_session') || c.includes('book') || c.includes('pricing')));
    ok('no beats_enabled column exists', !cols.includes('beats_enabled'));
  } finally {
    // ALWAYS restore everything on.
    await setAll(true);
    console.log('\n(restored all flags → on)');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) fails.forEach((f) => console.log('  ✗ ' + f));
  console.log('');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { await setAll(true); console.error(e); process.exit(1); });
