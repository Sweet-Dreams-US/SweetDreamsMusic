import { PRICING, ROOM_RATES, ROOM_RATES_SINGLE, SWEET_4, BAND_PRICING, SUPER_ADMINS, GUEST_FEE_PER_HOUR, FREE_GUESTS, type Room, type UserRole } from './constants';

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

/**
 * Render a session duration (in hours) as a human-readable label.
 *
 * Migration 059 widened `bookings.duration` to `numeric(5,2)` so engineers
 * can record actual session length in 15-min increments after a session
 * runs long. Quarter-hour values render as compound labels:
 *
 *   1     → "1hr"
 *   1.25  → "1hr 15min"
 *   1.5   → "1hr 30min"
 *   1.75  → "1hr 45min"
 *   2     → "2hr"
 *   0.5   → "30min"
 *
 * Anything that isn't on a 15-min boundary falls back to decimal hours
 * ("1.33hr") rather than silently truncating, so consumers never lie
 * about precision. Invalid or non-positive inputs render as "—" so call
 * sites don't have to null-check.
 */
export function formatDuration(hours: number | string | null | undefined): string {
  const n = typeof hours === 'string' ? Number(hours) : hours;
  if (!Number.isFinite(n) || (n as number) <= 0) return '—';
  const totalMins = Math.round((n as number) * 60);
  const onQuarter = totalMins % 15 === 0;
  if (!onQuarter) return `${(n as number).toFixed(2)}hr`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}min`;
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Returns the surcharge tier for a given hour (0-23, can be decimal like 18.5) */
export function getHourSurcharge(hour: number): { tier: 'regular' | 'lateNight' | 'deepNight'; amount: number } {
  const h = Math.floor(hour) % 24;
  // 2AM-8AM: deep night (+$30/hr)
  if (h >= 2 && h < 9) return { tier: 'deepNight', amount: PRICING.deepNightSurcharge };
  // 10PM-1AM: late night (+$10/hr)
  if (h >= 22 || h < 2) return { tier: 'lateNight', amount: PRICING.lateNightSurcharge };
  // 9AM-10PM: regular (no surcharge)
  return { tier: 'regular', amount: 0 };
}

export function isSameDay(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export type HourBreakdown = {
  hour: number;
  baseRate: number;
  nightFee: number;
  sameDayFee: number;
  hourTotal: number;
  tier: 'regular' | 'lateNight' | 'deepNight';
};

export type SessionPricing = {
  subtotal: number;
  hourBreakdown: HourBreakdown[];
  nightFees: number;
  sameDayFee: number;
  guestFee: number;
  guestCount: number;
  sweetSpot: boolean;
  total: number;
  deposit: number;
};

export function calculateSessionTotal(
  room: Room,
  hours: number,
  startHour: number,
  isSameDayBooking: boolean,
  guestCount: number = 1
): SessionPricing {
  // Check for The Sweet 4 deal (4 hours flat rate)
  const sweet4 = SWEET_4[room];
  const isSweet4 = hours === sweet4.hours;

  // Calculate base rate per hour
  let basePerHour: number;
  if (isSweet4) {
    basePerHour = sweet4.perHour;
  } else if (hours === 1) {
    basePerHour = ROOM_RATES_SINGLE[room];
  } else {
    basePerHour = ROOM_RATES[room];
  }

  // Build per-hour breakdown (startHour can be decimal, e.g. 18.5 for 6:30 PM)
  const hourBreakdown: HourBreakdown[] = [];
  let nightFees = 0;
  let sameDayFee = 0;

  for (let i = 0; i < hours; i++) {
    const h = (startHour + i) % 24;
    const surcharge = getHourSurcharge(Math.floor(h));
    const sdFee = isSameDayBooking ? PRICING.sameDaySurcharge : 0;

    const entry: HourBreakdown = {
      hour: h,
      baseRate: basePerHour,
      nightFee: surcharge.amount,
      sameDayFee: sdFee,
      hourTotal: basePerHour + surcharge.amount + sdFee,
      tier: surcharge.tier,
    };

    hourBreakdown.push(entry);
    nightFees += surcharge.amount;
    sameDayFee += sdFee;
  }

  const subtotal = isSweet4 ? sweet4.price : basePerHour * hours;
  const extraGuests = Math.max(0, guestCount - FREE_GUESTS);
  const guestFee = extraGuests * GUEST_FEE_PER_HOUR * hours;
  const total = subtotal + nightFees + sameDayFee + guestFee;
  const deposit = Math.round(total * (PRICING.depositPercent / 100));

  // NOTE: `sweetSpot` field kept as-is for backward compat with callers
  // that read the boolean flag. The user-facing product is now "The Sweet 4".
  return { subtotal, hourBreakdown, nightFees, sameDayFee, guestFee, guestCount, sweetSpot: isSweet4, total, deposit };
}

// ============================================================
// Band session pricing (Phase 3)
// ============================================================
// Band sessions use flat-rate packages from BAND_PRICING (Studio A only).
// Unlike solo sessions, band bookings do NOT stack night / same-day / guest
// surcharges — the package price is all-in, because the band IS the guest
// list and the package framing exists precisely to be predictable.
//
// As of 2026-04-28 the self-serve flow supports 4h, 8h, AND 24h (the 3-day
// block). The 24h tier still requires admin follow-up by phone to pin
// down logistics, but the deposit + calendar reservation goes through
// the same Stripe checkout path as the shorter tiers. Webhook fans out
// 24h into 3 separate booking rows linked by booking_group_id.

export type BandSessionPricing = {
  hours: 4 | 8 | 24;
  tier: (typeof BAND_PRICING)[number];
  subtotal: number;
  nightFees: number;   // always 0 — flat-rate package
  sameDayFee: number;  // always 0
  guestFee: number;    // always 0 — band members aren't guests
  total: number;
  deposit: number;
};

/**
 * Validates an arbitrary number is a supported self-serve band tier.
 * As of 2026-04-28 the 24h ("3 Days") tier is self-serve bookable —
 * checkout creates 3 linked bookings rows and admin follows up by phone
 * to finalize details.
 */
export function isSelfServeBandHours(h: unknown): h is 4 | 8 | 24 {
  return h === 4 || h === 8 || h === 24;
}

/**
 * Bands can attach the Sweet Spot filming add-on on top of an 8hr or
 * 24hr (3-day) session. Pricing per Cole 2026-04-28: $2,000 on top of an
 * 8hr session, $1,000 on top of the 3-day block. The session length is
 * extended by 2 hours of filming time — for 3-day, the band picks which
 * day gets the filming hours appended.
 */
export type SweetSpotAddon =
  | { kind: '8hr-addon' }
  | { kind: '3day-addon'; filmingDayIndex: 0 | 1 | 2 };

export function calculateBandSessionTotal(
  hours: 4 | 8 | 24,
  sweetSpot?: SweetSpotAddon | null,
): BandSessionPricing {
  const tier = BAND_PRICING.find((t) => t.hours === hours);
  if (!tier) {
    // Should never hit this if callers type-gate via isSelfServeBandHours,
    // but belt-and-suspenders for JS callers.
    throw new Error(`Invalid band tier: ${hours}h. Supported: 4, 8, 24.`);
  }
  let total = tier.price;
  if (sweetSpot) {
    // Validate the add-on tier matches the session length so a UI bug
    // can't accidentally charge the wrong amount.
    if (sweetSpot.kind === '8hr-addon' && hours === 8) {
      total += 200000; // $2,000
    } else if (sweetSpot.kind === '3day-addon' && hours === 24) {
      total += 100000; // $1,000
    }
  }
  const deposit = Math.round(total * (PRICING.depositPercent / 100));
  return {
    hours,
    tier,
    subtotal: total,
    nightFees: 0,
    sameDayFee: 0,
    guestFee: 0,
    total,
    deposit,
  };
}

export function getUserRole(email: string | undefined, profileRole?: string): UserRole {
  if (!email) return 'user';
  if (SUPER_ADMINS.includes(email.toLowerCase() as typeof SUPER_ADMINS[number])) return 'admin';
  if (profileRole === 'engineer') return 'engineer';
  // Media managers run the media/video/photo booking side (mirrors engineers
  // for the studio side). DB-driven role — assigned via Admin → Users — not a
  // hardcoded roster, so the media crew can change without a deploy.
  if (profileRole === 'media_manager') return 'media_manager';
  // Agent = the Cowork service account that records weekly artist stats in the
  // /agent/stats console. DB-driven role; without this branch profiles.role
  // 'agent' would fall through to 'user' and the console would be unreachable.
  if (profileRole === 'agent') return 'agent';
  return 'user';
}

export function formatTime(slot: string): string {
  const [h, m] = slot.split(':').map(Number);
  const min = (m || 0) >= 30 ? ':30' : ':00';
  if (h === 0) return `12${min} AM`;
  if (h < 12) return `${h}${min} AM`;
  if (h === 12) return `12${min} PM`;
  return `${h - 12}${min} PM`;
}

/** Parse "18:30" → 18.5 */
export function parseTimeSlot(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h + (m || 0) / 60;
}

/** Convert decimal hour 18.5 → "18:30" */
export function decimalToTimeStr(dec: number): string {
  const h = Math.floor(dec) % 24;
  const m = dec % 1 >= 0.5 ? '30' : '00';
  return `${h}:${m}`;
}
