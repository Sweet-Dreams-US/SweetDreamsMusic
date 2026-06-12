/**
 * scripts/studio-pricing-parity.ts — proves the DB-driven config pricing reproduces
 * the current hardcoded pricing EXACTLY, across the full matrix. This is the gate
 * for the engine cutover: if any combo differs, the refactor would change a price.
 *   npx tsx scripts/studio-pricing-parity.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { calculateSessionTotal, calculateBandSessionTotal, type SweetSpotAddon } from '../lib/utils';
import { ROOMS, type Room } from '../lib/constants';
import { priceSessionFromConfig, priceBandFromConfig, studioConfigFromConstants } from '../lib/studio-config';

let checks = 0, diffs = 0; const samples: string[] = [];
function same(label: string, a: any, b: any) {
  checks++;
  const fields = ['total', 'deposit', 'subtotal', 'nightFees', 'sameDayFee', 'guestFee'] as const;
  for (const f of fields) {
    if (a[f] !== b[f]) { diffs++; if (samples.length < 10) samples.push(`${label} · ${f}: current ${a[f]} ≠ config ${b[f]}`); return; }
  }
}

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8];
const START_HOURS = [0, 1, 2, 3, 7, 8, 9, 12, 17, 18, 20, 21, 22, 23];
const GUESTS = [1, 2, 3, 4, 6, 12];

console.log('\n=== Studio pricing PARITY: config vs current constants ===\n');

for (const room of ROOMS as readonly Room[]) {
  const config = studioConfigFromConstants(room);
  for (const hours of HOURS) {
    for (const sh of START_HOURS) {
      for (const sameDay of [false, true]) {
        for (const guests of GUESTS) {
          const current = calculateSessionTotal(room, hours, sh, sameDay, guests);
          const cfg = priceSessionFromConfig(config, { hours, startHour: sh, sameDay, guests });
          same(`solo ${room} h${hours} s${sh} sd${sameDay ? 1 : 0} g${guests}`, current, cfg);
        }
      }
    }
  }
}

// Band (Studio A config has the band tiers).
const bandConfig = studioConfigFromConstants('studio_a');
const addons: Record<number, SweetSpotAddon | undefined> = {
  4: undefined,
  8: { kind: '8hr-addon' },
  24: { kind: '3day-addon', filmingDayIndex: 0 },
};
for (const tier of [4, 8, 24] as const) {
  same(`band h${tier} no-addon`, calculateBandSessionTotal(tier), priceBandFromConfig(bandConfig, tier));
  const addon = addons[tier];
  if (addon) {
    same(`band h${tier} +addon`, calculateBandSessionTotal(tier, addon), priceBandFromConfig(bandConfig, tier, addon as never));
  }
}

console.log(`Checked ${checks} combinations.`);
if (diffs === 0) console.log(`\n✅ EXACT PARITY — config reproduces every price (${checks} combos identical)\n`);
else { console.log(`\n❌ ${diffs} combos DIFFER:`); samples.forEach((s) => console.log('  ' + s)); console.log(''); }
process.exit(diffs === 0 ? 0 : 1);
