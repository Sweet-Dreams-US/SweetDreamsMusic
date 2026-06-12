/**
 * scripts/studio-pricing-db-roundtrip.ts — the engine-cutover gate.
 *
 *   npx tsx --env-file=.env.local scripts/studio-pricing-db-roundtrip.ts
 *   npx tsx --env-file=.env.local scripts/studio-pricing-db-roundtrip.ts --seed   # seed first, then verify
 *
 * Proves the FULL round trip: constants → seedStudiosFromConstants (DB) →
 * getStudioConfig (read back from DB) → priceSessionFromConfig reproduces the
 * golden snapshot EXACTLY. If this passes, the booking engine can read pricing
 * from the DB with zero change to a single charged cent.
 *
 * Read-only by default; pass --seed to (idempotently) seed prod from constants first.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { priceSessionFromConfig, priceBandFromConfig, type StudioConfig } from '../lib/studio-config';
import { getStudioConfig, seedStudiosFromConstants } from '../lib/studio-config-server';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local');
  process.exit(1);
}
const db = createClient(URL, KEY);
const SEED = process.argv.includes('--seed');

type Row = { total: number; deposit: number; subtotal: number; nightFees: number; sameDayFee: number; guestFee: number };
const FIELDS = ['total', 'deposit', 'subtotal', 'nightFees', 'sameDayFee', 'guestFee'] as const;

async function main() {
  if (SEED) {
    console.log('\n→ Seeding studio_rooms / tiers / surcharges / engineers from constants…');
    const r = await seedStudiosFromConstants(db);
    console.log(`  location_id=${r.locationId} · rooms=${r.rooms} tiers=${r.tiers} surcharges=${r.surcharges} engineers=${r.engineers}`);
  }

  const snap = JSON.parse(readFileSync(join(__dirname, '__golden__', 'studio-pricing.json'), 'utf8')) as Record<string, Row>;
  const keys = Object.keys(snap);
  console.log(`\n=== DB round-trip parity vs golden (${keys.length} combos) ===\n`);

  // Cache one DB config per room slug.
  const cfgCache = new Map<string, StudioConfig>();
  async function cfg(slug: string): Promise<StudioConfig> {
    if (!cfgCache.has(slug)) cfgCache.set(slug, await getStudioConfig(db, slug));
    return cfgCache.get(slug)!;
  }

  let checks = 0, diffs = 0; const samples: string[] = [];
  const cmp = (label: string, want: Row, got: any) => {
    checks++;
    for (const f of FIELDS) {
      if (want[f] !== got[f]) { diffs++; if (samples.length < 12) samples.push(`${label} · ${f}: golden ${want[f]} ≠ DB ${got[f]}`); return; }
    }
  };

  for (const key of keys) {
    if (key.startsWith('solo|')) {
      const [, room, h, s, sd, g] = key.split('|');
      const config = await cfg(room);
      const got = priceSessionFromConfig(config, {
        hours: Number(h.slice(1)), startHour: Number(s.slice(1)), sameDay: sd === 'sd1', guests: Number(g.slice(1)),
      });
      cmp(key, snap[key], got);
    } else if (key.startsWith('band|')) {
      const [, h, ss] = key.split('|');
      const hours = Number(h.slice(1));
      const config = await cfg('studio_a');
      const addon = ss === 'ss1' ? (hours === 8 ? { kind: '8hr-addon' as const } : { kind: '3day-addon' as const }) : null;
      const got = priceBandFromConfig(config, hours, addon as never);
      cmp(key, snap[key], got);
    }
  }

  console.log(`Checked ${checks} combinations (read back from the DB).`);
  if (diffs === 0) {
    console.log(`\n✅ EXACT PARITY — the DB reproduces every golden price (${checks} combos). Engine cutover is safe.\n`);
    process.exit(0);
  }
  console.log(`\n❌ ${diffs} combos DIFFER:`); samples.forEach((s) => console.log('  ' + s)); console.log('');
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
