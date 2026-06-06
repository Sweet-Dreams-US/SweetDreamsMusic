// lib/studio-config.ts — DB-driven studio config + pricing (the linchpin).
//
// priceSessionFromConfig / priceBandFromConfig reproduce calculateSessionTotal /
// calculateBandSessionTotal EXACTLY, but from a StudioConfig object instead of the
// hardcoded constants — so studios become admin-editable without changing pricing.
// Parity is enforced by scripts/studio-pricing-golden.ts (1157 combos must match).
//
// Pure (no server deps) so it's testable + usable client + server. The DB loader +
// seed live in lib/studio-config-server.ts; studioConfigFromConstants() here builds
// the same shape from the current constants (the seed source AND the safe fallback).

import {
  ROOM_RATES, ROOM_RATES_SINGLE, SWEET_4, BAND_PRICING, PRICING,
  GUEST_FEE_PER_HOUR, FREE_GUESTS, MAX_GUESTS, ROOM_LABELS, STUDIO_A_WEEKDAY_START,
  type Room,
} from '@/lib/constants';

export interface StudioTier { kind: string; hours: number; priceCents: number; perHourCents: number; label?: string; note?: string }
export interface StudioSurcharge { kind: 'late_night' | 'deep_night' | 'same_day'; startHour: number | null; endHour: number | null; amountCents: number }

export interface StudioConfig {
  slug: string;
  displayName: string;
  hourlyRateCents: number;
  singleHourRateCents: number;
  depositPercent: number;
  minHours: number;
  maxHours: number;
  freeGuests: number;
  guestFeeCents: number;
  maxGuests: number;
  weekdayStartHour: number | null;
  openHour: number;
  closeHour: number;
  sameDayBufferHours: number;
  bandEnabled: boolean;
  tiers: StudioTier[];
  surcharges: StudioSurcharge[];
}

export interface SessionPriceResult {
  subtotal: number; nightFees: number; sameDayFee: number; guestFee: number; total: number; deposit: number;
}

/** True if hour h falls in [start,end) — handling windows that wrap past midnight (start>end). */
function inWindow(h: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null) return false;
  return start <= end ? (h >= start && h < end) : (h >= start || h < end);
}

/** Per-hour night surcharge from config — deep-night checked before late-night (matches getHourSurcharge). */
function nightSurchargeForHour(config: StudioConfig, h: number): number {
  const deep = config.surcharges.find((s) => s.kind === 'deep_night' && inWindow(h, s.startHour, s.endHour));
  if (deep) return deep.amountCents;
  const late = config.surcharges.find((s) => s.kind === 'late_night' && inWindow(h, s.startHour, s.endHour));
  if (late) return late.amountCents;
  return 0;
}

/**
 * Solo session price from config — byte-for-byte equal to calculateSessionTotal.
 * Sweet-4 when hours === the sweet_4 tier's hours; single rate at 1hr; else hourly.
 * Night + same-day surcharges stack per hour; guest fee for guests beyond free_guests.
 */
export function priceSessionFromConfig(
  config: StudioConfig,
  opts: { hours: number; startHour: number; sameDay: boolean; guests: number },
): SessionPriceResult {
  const { hours, startHour, sameDay, guests } = opts;
  const sweet4 = config.tiers.find((t) => t.kind === 'sweet_4');
  const isSweet4 = !!sweet4 && hours === sweet4.hours;
  const basePerHour = isSweet4 ? sweet4!.perHourCents : hours === 1 ? config.singleHourRateCents : config.hourlyRateCents;
  const sameDayCents = config.surcharges.find((s) => s.kind === 'same_day')?.amountCents ?? 0;

  let nightFees = 0;
  let sameDayFee = 0;
  for (let i = 0; i < hours; i++) {
    const h = Math.floor((startHour + i) % 24);
    nightFees += nightSurchargeForHour(config, h);
    sameDayFee += sameDay ? sameDayCents : 0;
  }
  const subtotal = isSweet4 ? sweet4!.priceCents : basePerHour * hours;
  const extraGuests = Math.max(0, guests - config.freeGuests);
  const guestFee = extraGuests * config.guestFeeCents * hours;
  const total = subtotal + nightFees + sameDayFee + guestFee;
  const deposit = Math.round(total * (config.depositPercent / 100));
  return { subtotal, nightFees, sameDayFee, guestFee, total, deposit };
}

/** Band session price from config — equal to calculateBandSessionTotal (flat, no surcharges). */
export function priceBandFromConfig(
  config: StudioConfig,
  hours: number,
  addon?: { kind: '8hr-addon' } | { kind: '3day-addon' } | null,
): SessionPriceResult {
  const tier = config.tiers.find((t) => t.kind === `band_${hours}h`);
  if (!tier) throw new Error(`No band tier for ${hours}h on studio ${config.slug}`);
  let total = tier.priceCents;
  if (addon?.kind === '8hr-addon' && hours === 8) total += 200000;
  else if (addon?.kind === '3day-addon' && hours === 24) total += 100000;
  const deposit = Math.round(total * (config.depositPercent / 100));
  return { subtotal: total, nightFees: 0, sameDayFee: 0, guestFee: 0, total, deposit };
}

/**
 * Build a StudioConfig from the CURRENT constants — the seed source for the DB and
 * the safe fallback if a studio row is ever missing. Keeps day-one behavior identical.
 */
export function studioConfigFromConstants(room: Room): StudioConfig {
  const bandEnabled = room === 'studio_a';
  const tiers: StudioTier[] = [
    { kind: 'sweet_4', hours: SWEET_4[room].hours, priceCents: SWEET_4[room].price, perHourCents: SWEET_4[room].perHour, label: SWEET_4[room].label },
  ];
  if (bandEnabled) {
    for (const t of BAND_PRICING) {
      tiers.push({ kind: `band_${t.hours}h`, hours: t.hours, priceCents: t.price, perHourCents: t.perHour, label: t.label, note: t.note });
    }
  }
  return {
    slug: room,
    displayName: ROOM_LABELS[room],
    hourlyRateCents: ROOM_RATES[room],
    singleHourRateCents: ROOM_RATES_SINGLE[room],
    depositPercent: PRICING.depositPercent,
    minHours: PRICING.minHours,
    maxHours: PRICING.maxHours,
    freeGuests: FREE_GUESTS,
    guestFeeCents: GUEST_FEE_PER_HOUR,
    maxGuests: MAX_GUESTS,
    weekdayStartHour: room === 'studio_a' ? STUDIO_A_WEEKDAY_START : null,
    openHour: 0,
    closeHour: 24,
    sameDayBufferHours: 3,
    bandEnabled,
    tiers,
    surcharges: [
      { kind: 'deep_night', startHour: 2, endHour: 9, amountCents: PRICING.deepNightSurcharge },
      { kind: 'late_night', startHour: 22, endHour: 2, amountCents: PRICING.lateNightSurcharge },
      { kind: 'same_day', startHour: null, endHour: null, amountCents: PRICING.sameDaySurcharge },
    ],
  };
}
