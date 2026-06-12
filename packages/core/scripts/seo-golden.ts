// scripts/seo-golden.ts — SEO golden for the whitelabel hardening (task #60).
//
// THE CONTRACT: the brand/metadata refactor must emit BYTE-IDENTICAL SEO
// output for Sweet Dreams' values. This script snapshots every public page's
// <head> SEO surface (title, meta, canonical, OG/Twitter, JSON-LD) plus
// robots.txt + sitemap shape from a LOCAL prod build, and verifies against
// the committed baseline.
//
// Usage:
//   1. npm run build && PORT=4321 npm start &   (wrapper: scripts/seo-golden.sh)
//   2. npx tsx scripts/seo-golden.ts --write    # baseline (BEFORE refactor)
//      npx tsx scripts/seo-golden.ts            # verify (AFTER refactor)
//
// Never run against production — localhost only by design.

import { readFileSync, writeFileSync, existsSync } from 'fs';

const BASE = process.env.SEO_BASE_URL || 'http://localhost:4321';
const GOLDEN_PATH = 'packages/core/scripts/__golden__/seo.json';
const WRITE = process.argv.includes('--write');

const PAGES = [
  '/', '/book', '/pricing', '/beats', '/sell-beats', '/engineers',
  '/events', '/bands', '/media', '/about', '/contact', '/blog',
];

interface PageSeo {
  title: string | null;
  metas: Record<string, string>;     // name/property → content (sorted keys)
  canonical: string | null;
  jsonLd: unknown[];                 // parsed + stable-ordered
}

function extractHead(html: string): string {
  const m = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return m ? m[1] : '';
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableSort(v)]));
  }
  return value;
}

function parsePage(html: string): PageSeo {
  const head = extractHead(html);
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;

  const metas: Record<string, string> = {};
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const key = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1];
    const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
    if (!key || content == null) continue;
    // Skip framework-internal/noise tags that aren't SEO surface.
    if (['viewport', 'next-size-adjust', 'theme-color', 'charset'].includes(key)) continue;
    metas[key] = content;
  }

  const canonical = head.match(/<link\s[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
    ?? head.match(/<link\s[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1] ?? null;

  // JSON-LD lives in body sometimes too — scan the whole document.
  const jsonLd: unknown[] = [];
  for (const block of html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try { jsonLd.push(stableSort(JSON.parse(inner))); } catch { jsonLd.push({ UNPARSEABLE: inner.slice(0, 200) }); }
  }
  jsonLd.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return {
    title,
    metas: Object.fromEntries(Object.entries(metas).sort(([a], [b]) => a.localeCompare(b))),
    canonical, jsonLd,
  };
}

async function main() {
  const snapshot: Record<string, PageSeo | { raw: string }> = {};

  for (const path of PAGES) {
    const res = await fetch(`${BASE}${path}`, { headers: { 'user-agent': 'seo-golden' } });
    if (!res.ok) { console.error(`✗ ${path} → HTTP ${res.status}`); process.exit(1); }
    snapshot[path] = parsePage(await res.text());
    console.log(`  captured ${path}`);
  }
  // robots + sitemap: raw, with two sitemap normalizations. lastmod churns per
  // build — stripped. <url> entries are sorted by <loc>: sitemap.ts orders
  // /u/[slug] by profiles.updated_at DESC, which is LIVE data, so raw order
  // drifts whenever any user touches their profile (caught 2026-06-12: a "diff"
  // of 60 reordered URLs, identical 210-URL set). The URL SET is the SEO
  // surface; entry order carries no meaning to crawlers.
  for (const f of ['/robots.txt', '/sitemap.xml']) {
    const res = await fetch(`${BASE}${f}`);
    let raw = res.ok ? (await res.text()).trim() : `HTTP ${res.status}`;
    raw = raw.replace(/<lastmod>[^<]*<\/lastmod>/g, '<lastmod/>');
    if (f === '/sitemap.xml' && res.ok) {
      const entries = raw.match(/<url>[\s\S]*?<\/url>/g);
      if (entries) {
        const loc = (s: string) => s.match(/<loc>([^<]*)<\/loc>/)?.[1] ?? '';
        const sorted = [...entries].sort((x, y) => loc(x).localeCompare(loc(y)));
        let i = 0;
        raw = raw.replace(/<url>[\s\S]*?<\/url>/g, () => sorted[i++]);
      }
    }
    snapshot[f] = { raw };
    console.log(`  captured ${f}`);
  }

  const out = JSON.stringify(snapshot, null, 2);
  if (WRITE) {
    writeFileSync(GOLDEN_PATH, out);
    console.log(`\n✅ SEO baseline written: ${GOLDEN_PATH} (${PAGES.length} pages + robots + sitemap)`);
    return;
  }

  if (!existsSync(GOLDEN_PATH)) { console.error('No baseline — run with --write first.'); process.exit(1); }
  const baseline = readFileSync(GOLDEN_PATH, 'utf8');
  if (baseline === out) {
    console.log('\n✅ SEO GOLDEN: byte-identical to baseline. Safe.');
    return;
  }
  // Show a focused diff.
  const a = JSON.parse(baseline) as Record<string, any>;
  const b = JSON.parse(out) as Record<string, any>;
  let diffs = 0;
  for (const page of Object.keys(a)) {
    const sa = JSON.stringify(a[page], null, 2), sb = JSON.stringify(b[page] ?? null, null, 2);
    if (sa !== sb) {
      diffs++;
      console.error(`\n✗ DRIFT on ${page}:`);
      const la = sa.split('\n'), lb = sb.split('\n');
      for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        if (la[i] !== lb[i]) console.error(`  - ${la[i] ?? '(missing)'}\n  + ${lb[i] ?? '(missing)'}`);
      }
    }
  }
  console.error(`\n❌ SEO GOLDEN: ${diffs} page(s) drifted. DO NOT SHIP.`);
  process.exit(1);
}

main();
