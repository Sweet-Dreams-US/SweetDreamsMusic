/**
 * scripts/studio-pricing-golden.ts — GOLDEN pricing snapshot.
 *   npx tsx scripts/studio-pricing-golden.ts          # verify against the snapshot
 *   npx tsx scripts/studio-pricing-golden.ts --write   # (re)write the snapshot
 *
 * Snapshots calculateSessionTotal / calculateBandSessionTotal across the FULL
 * matrix (rooms × hours × start-hour × rush-tier × guests, + band tiers). The
 * DB-driven config pricing must reproduce every value EXACTLY — this file is the
 * contract that guarantees the refactor doesn't change a single cent. The rush
 * dimension now covers all Booking Rush Fee tiers (0 / $10 / $20 / $30 per hour).
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { calculateSessionTotal, calculateBandSessionTotal } from '../lib/utils';
import { ROOMS, type Room } from '../lib/constants';

const SNAP = join(process.cwd(), 'scripts', '__golden__', 'studio-pricing.json');
const WRITE = process.argv.includes('--write');

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8];
const START_HOURS = [9, 12, 18, 20, 22, 23, 1, 3, 7]; // regular, evening, late-night, deep-night
const RUSH = [0, 1000, 2000, 3000]; // Booking Rush Fee per hour: none / $10 / $20 / $30
const GUESTS = [1, 3, 4, 6];
const BAND_TIERS = [4, 8, 24] as const;

type Row = { total: number; deposit: number; subtotal: number; nightFees: number; bookingRushFee: number; guestFee: number };
const snap: Record<string, Row> = {};

for (const room of ROOMS as readonly Room[]) {
  for (const hours of HOURS) {
    for (const sh of START_HOURS) {
      for (const rush of RUSH) {
        for (const guests of GUESTS) {
          const p = calculateSessionTotal(room, hours, sh, rush, guests);
          const key = `solo|${room}|h${hours}|s${sh}|r${rush}|g${guests}`;
          snap[key] = { total: p.total, deposit: p.deposit, subtotal: p.subtotal, nightFees: p.nightFees, bookingRushFee: p.bookingRushFee, guestFee: p.guestFee };
        }
      }
    }
  }
}
for (const tier of BAND_TIERS) {
  const base = calculateBandSessionTotal(tier);
  snap[`band|h${tier}|ss0`] = { total: base.total, deposit: base.deposit, subtotal: base.subtotal, nightFees: 0, bookingRushFee: 0, guestFee: base.guestFee };
  // Sweet Spot add-on is only valid on 8hr (+$2000) and 24hr (+$1000).
  if (tier === 8 || tier === 24) {
    const addon = tier === 8 ? { kind: '8hr-addon' as const } : { kind: '3day-addon' as const, filmingDayIndex: 0 as const };
    const p = calculateBandSessionTotal(tier, addon);
    snap[`band|h${tier}|ss1`] = { total: p.total, deposit: p.deposit, subtotal: p.subtotal, nightFees: 0, bookingRushFee: 0, guestFee: p.guestFee };
  }
}

const keys = Object.keys(snap);
console.log(`Generated ${keys.length} pricing combinations.`);

// Hand-checked anchors (independent of the snapshot file).
let bad = 0;
const expect = (name: string, got: number, want: number) => { if (got !== want) { bad++; console.log(`  ✗ ${name}: got ${got} want ${want}`); } };
expect('Studio B 3hr 12pm no fees total', snap['solo|studio_b|h3|s12|r0|g1'].total, 15000);
expect('Studio B 3hr 12pm deposit', snap['solo|studio_b|h3|s12|r0|g1'].deposit, 7500);
expect('Studio A 1hr 12pm (single rate)', snap['solo|studio_a|h1|s12|r0|g1'].total, 8000);
expect('Studio B 1hr 12pm (single rate)', snap['solo|studio_b|h1|s12|r0|g1'].total, 6000);
expect('Studio A 3hr 12pm', snap['solo|studio_a|h3|s12|r0|g1'].total, 21000);
expect('Sweet-4 Studio B (4hr 12pm)', snap['solo|studio_b|h4|s12|r0|g1'].total, 18000);
expect('Sweet-4 Studio A (4hr 12pm)', snap['solo|studio_a|h4|s12|r0|g1'].total, 26000);
expect('Studio B 1hr 11pm (+$10 late)', snap['solo|studio_b|h1|s23|r0|g1'].total, 7000);
expect('Studio B 1hr 3am (+$30 deep)', snap['solo|studio_b|h1|s3|r0|g1'].total, 9000);
expect('Studio B 3hr 12pm rush $10/hr (+$30)', snap['solo|studio_b|h3|s12|r1000|g1'].total, 18000);
expect('Studio B 3hr 12pm rush $20/hr (+$60)', snap['solo|studio_b|h3|s12|r2000|g1'].total, 21000);
expect('Studio B 3hr 12pm rush $30/hr (+$90)', snap['solo|studio_b|h3|s12|r3000|g1'].total, 24000);
expect('Studio B 3hr 11pm rush $30 (3 late + 3 rush)', snap['solo|studio_b|h3|s23|r3000|g1'].total, 15000 + 3000 + 9000);
expect('Studio B 3hr 12pm 5 guests (+2×$10×3)', snap['solo|studio_b|h3|s12|r0|g6'].total, 15000 + 3 * 1000 * 3);
expect('Band 4hr', snap['band|h4|ss0'].total, 44000);
expect('Band 8hr', snap['band|h8|ss0'].total, 70000);
expect('Band 24hr (3-day)', snap['band|h24|ss0'].total, 180000);
console.log(bad === 0 ? '  ✓ all hand-checked anchors pass' : `  ✗ ${bad} anchors FAILED`);

if (WRITE) {
  mkdirSync(join(process.cwd(), 'scripts', '__golden__'), { recursive: true });
  writeFileSync(SNAP, JSON.stringify(snap, null, 0));
  console.log(`\n✅ Snapshot written: ${SNAP} (${keys.length} combos)`);
} else if (existsSync(SNAP)) {
  const prev = JSON.parse(readFileSync(SNAP, 'utf8')) as Record<string, Row>;
  let diff = 0;
  for (const k of keys) if (JSON.stringify(prev[k]) !== JSON.stringify(snap[k])) { diff++; if (diff <= 5) console.log(`  ✗ DIFF ${k}: ${JSON.stringify(prev[k])} → ${JSON.stringify(snap[k])}`); }
  for (const k of Object.keys(prev)) if (!(k in snap)) { diff++; if (diff <= 5) console.log(`  ✗ MISSING now: ${k}`); }
  console.log(diff === 0 ? `\n✅ MATCHES snapshot (${keys.length} combos identical)` : `\n❌ ${diff} combos differ from snapshot`);
  process.exit(bad === 0 && diff === 0 ? 0 : 1);
} else {
  console.log('\n(no snapshot yet — run with --write to create it)');
}
process.exit(bad === 0 ? 0 : 1);
