#!/usr/bin/env node
// scripts/create-studio.mjs — scaffold a new studio app from the flagship.
//
// apps/sweetdreams IS the template: every page works, every route exists, all
// reading brand_settings / site_content / studio_rooms from the studio's OWN
// database. create-studio copies that shape, strips Sweet-Dreams-specific
// content, and stamps the contract files. The Claude Code design session then
// restyles ONLY the new app.
//
// Usage: node scripts/create-studio.mjs <slug> "<Studio Name>"

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const slug = process.argv[2];
const name = process.argv[3];

if (!slug || !name || !/^[a-z][a-z0-9-]+$/.test(slug)) {
  console.error('Usage: node scripts/create-studio.mjs <slug> "<Studio Name>"  (slug: lowercase, dashes)');
  process.exit(1);
}
const APP = join(ROOT, 'apps', slug);
if (existsSync(APP)) { console.error(`apps/${slug} already exists`); process.exit(1); }

console.log(`\n═══ create-studio: ${name} (apps/${slug}) ═══`);

// 1. Copy the flagship app shape.
cpSync(join(ROOT, 'apps', 'sweetdreams'), APP, {
  recursive: true,
  filter: (src) => !src.includes('node_modules') && !src.includes('/.next') && !src.endsWith('.env.local'),
});
console.log('✓ copied apps/sweetdreams shape');

// 2. Strip Sweet-Dreams-specific content (their DB + design pass replace it).
for (const dir of ['contracts', 'blog-outlines']) {
  rmSync(join(APP, dir), { recursive: true, force: true });
}
console.log('✓ stripped studio-specific content (contracts, blog-outlines)');

// 3. package.json identity.
const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
pkg.name = `@dreamsuite/${slug}`;
writeFileSync(join(APP, 'package.json'), JSON.stringify(pkg, null, 2));

// 4. vercel.json: fresh crons (same schedule set), no branch overrides.
const vercel = JSON.parse(readFileSync(join(APP, 'vercel.json'), 'utf8'));
delete vercel.git;
writeFileSync(join(APP, 'vercel.json'), JSON.stringify(vercel, null, 2));

// 5. Stamp the contract + README.
const contract = readFileSync(join(ROOT, 'packages', 'core', 'docs', 'STUDIO_APP_CONTRACT.md'), 'utf8')
  .replaceAll('{{STUDIO_NAME}}', name).replaceAll('{{SLUG}}', slug);
writeFileSync(join(APP, 'STUDIO_APP_CONTRACT.md'), contract);
writeFileSync(join(APP, 'README.md'), `# ${name} — DreamSuite studio app

Scaffolded from apps/sweetdreams by create-studio. Backend = packages/core
(shared, updated for every studio at once). This app owns ONLY the look.

- Design tokens: app/globals.css (restyle freely)
- Brand/content/pricing: the studio's OWN database via their Control Panel
- Rules: read STUDIO_APP_CONTRACT.md before any Claude Code design session
- Env: copy .env.example → Vercel project env (their Supabase/Stripe/Resend)
`);

console.log(`✓ stamped contract + README

NEXT STEPS:
  1. HQ: node scripts/provision-studio.mjs ${slug}        (their infra — dry-run first)
  2. Wire apps/${slug}/.env.local → their Supabase (local dev)
  3. Claude Code design session in apps/${slug} ONLY (read the contract)
  4. Verify: golden battery + seo-golden against their instance
  5. Vercel project rootDirectory=apps/${slug}, domain cutover at launch
`);
