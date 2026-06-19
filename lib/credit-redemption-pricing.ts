// lib/credit-redemption-pricing.ts
//
// Pure pricing for the free-studio-hour redemption flow.
//
// THE MODEL (confirmed with Cole):
//   A "free studio hour" credit = ONE hour of BASE studio time off, room-aware.
//   The customer still pays the FULL surcharge (late-night / deep-night /
//   same-day / guests) up front by card. The base session is what the credit
//   discounts — capped at the booked hours.
//
//   discount = creditHoursApplied × applicableBasePerHourRate
//     creditHoursApplied = min(credit hours remaining, booked hours M)
//     applicableBasePerHourRate = the SAME per-hour rate the base session uses:
//       M == 1 → single-hour rate (studio_b $60)
//       M >= 2 → multi-hour rate  (studio_b $50)
//     (For the typical 1-hour reward credit: M==1 → $60, M>=2 → 1×$50.)
//
//   M == 1: the base is fully covered by the discount → the customer pays JUST
//           the surcharges, in full, now. No deposit split, no remainder.
//
//   M >= 2: deposit  = round(50% of the FULL total incl. surcharges)
//           amountDueNow = max(0, deposit − discount)
//           netTotal     = total − discount
//           remainder    = netTotal − amountDueNow
//           (If deposit < discount, amountDueNow=0 and the leftover discount
//            reduces the remainder, so the free hour's full value is always
//            honored.)
//
// PURE: no DB, no next, no Date. The caller resolves the studio-local (Eastern)
// start hour and the live StudioConfig and hands them in. This file just does
// the cents math, and is covered by scripts/credit-redemption-pricing-selfcheck.ts
// which proves the four worked examples below.
//
// Worked examples (studio_b; cents):
//   1. 1hr, 11pm (late), same-day → total 8000 (6000+1000+1000), discount 6000,
//      amountDueNow 2000, remainder 0.
//   2. 1hr, 11pm, NOT same-day     → total 7000, discount 6000, amountDueNow 1000,
//      remainder 0.
//   3. 1hr, 2pm, not same-day, 1 guest → total 6000, discount 6000, amountDueNow 0,
//      remainder 0 (instant confirm — no payment).
//   4. 3hr, 11pm, same-day → base 15000, surcharge 6000 (1×1000 late + 3×1000
//      same-day), total 21000, deposit 10500, discount 5000, amountDueNow 5500,
//      remainder 10500 (netTotal 16000).

import type { StudioConfig } from '@/lib/studio-config';
import { priceSessionFromConfig } from '@/lib/studio-config';
import type { Room } from '@/lib/constants';

export interface CreditRedemptionPricing {
  /** Full session value incl. all surcharges, before the credit discount (cents). */
  total: number;
  /** Base studio time only (subtotal), no surcharges (cents). */
  base: number;
  /** Sum of all surcharges (night + same-day + guest) (cents). */
  surcharges: number;
  /** Value of the free-hour credit applied to THIS booking (cents). */
  discount: number;
  /** total − discount: what the booking is ultimately worth to the customer (cents). */
  netTotal: number;
  /** Charged by card up front, now (cents). 0 → instant confirm, no Stripe. */
  amountDueNow: number;
  /** Owed after the session (cents). */
  remainder: number;
  /** Hours of credit actually consumed = min(remaining, booked hours). */
  creditHoursApplied: number;
  /** The full deposit (50% of total) before the discount is netted out (cents). */
  deposit: number;
}

export interface CreditRedemptionPricingInput {
  room: Room;
  /** Booked hours M (1–12). The credit only discounts up to M of them. */
  hours: number;
  /** Studio-LOCAL (Eastern) start hour, decimal allowed (e.g. 23 for 11pm, 18.5 for 6:30pm). */
  startHourLocal: number;
  sameDay: boolean;
  /** Number of GUESTS (artist not counted). */
  guestCount: number;
  /** Hours left on the credit being drawn from. */
  creditHoursRemaining: number;
  /** Live, room-aware studio pricing config (DB-driven, constants fallback). */
  pricing: StudioConfig;
}

/**
 * Compute the surcharge-aware, discounted-deposit pricing for a free-studio-hour
 * redemption. Reuses priceSessionFromConfig (the exact same engine the paid /book
 * flow uses) for the base + surcharge math, then applies the credit discount and
 * deposit rules above. Pure.
 */
export function computeCreditRedemptionPricing(
  input: CreditRedemptionPricingInput,
): CreditRedemptionPricing {
  const { hours, startHourLocal, sameDay, guestCount, creditHoursRemaining, pricing } = input;

  // ── Base + surcharge total — identical engine to the paid booking flow ──
  const priced = priceSessionFromConfig(pricing, {
    hours,
    startHour: startHourLocal,
    sameDay,
    guests: guestCount,
  });
  const total = priced.total;
  const base = priced.subtotal;
  const surcharges = priced.nightFees + priced.sameDayFee + priced.guestFee;

  // ── Credit discount ─────────────────────────────────────────────────────
  // creditHoursApplied is capped at the booked hours; extra hours are paid.
  // It must also never exceed the credit's remaining balance.
  const creditHoursApplied = Math.max(
    0,
    Math.min(Math.floor(creditHoursRemaining), hours),
  );
  // Applicable per-hour rate = the SAME rate the base used:
  //   M == 1 → single-hour rate; M >= 2 → multi-hour rate.
  // (Sweet-4 is a flat package, not a per-hour rate — credit redemption is a
  //  per-hour reward, so we use the plain hourly/single rate, not the sweet_4
  //  perHour. Sweet-4 + free-hour stacking is out of scope by design.)
  const applicableRate =
    hours === 1 ? pricing.singleHourRateCents : pricing.hourlyRateCents;
  const discount = creditHoursApplied * applicableRate;

  const netTotal = Math.max(0, total - discount);

  // The full standard deposit on the WHOLE total (incl. surcharges).
  const deposit = Math.round(total * (pricing.depositPercent / 100));

  let amountDueNow: number;
  let remainder: number;

  if (hours === 1) {
    // M == 1: base fully covered → pay JUST the surcharges, in full, now.
    // (When there are no surcharges this is 0 → instant confirm.)
    // netTotal == surcharges here because discount == base == total − surcharges.
    amountDueNow = netTotal;
    remainder = 0;
  } else {
    // M >= 2: deposit minus the discount, never below 0; leftover discount
    // (when deposit < discount) flows through to reduce the remainder.
    amountDueNow = Math.max(0, deposit - discount);
    remainder = netTotal - amountDueNow;
  }

  return {
    total,
    base,
    surcharges,
    discount,
    netTotal,
    amountDueNow,
    remainder,
    creditHoursApplied,
    deposit,
  };
}
