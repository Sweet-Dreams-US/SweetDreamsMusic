// lib/credit-redemption-pricing.ts
//
// Pure pricing for the free-studio-hour redemption flow.
//
// THE MODEL (confirmed with Cole):
//   A "free studio hour" credit is worth a FLAT $50 — the standard base studio
//   hour — no matter which room or duration it's redeemed against. It is NOT the
//   booked room's hourly rate: Studio A ($70/hr) and a Studio-B single hour
//   ($60) both still get exactly $50 off per credit hour. The customer pays the
//   rest (any base above the credit) plus the FULL surcharge (late-night /
//   deep-night / same-day / guests) up front by card.
//
//   discount = creditHoursApplied × FREE_HOUR_VALUE_CENTS ($50)
//     creditHoursApplied = min(credit hours remaining, booked hours M)
//   netTotal = total − discount (never below 0; the credit can't exceed total)
//
//   M == 1: no deposit split → pay the full discounted total (netTotal) now.
//           0 → instant confirm, no Stripe.
//
//   M >= 2: deposit  = round(50% of the FULL total incl. surcharges)
//           amountDueNow = max(0, deposit − discount)
//           remainder    = netTotal − amountDueNow
//           (If deposit < discount, amountDueNow=0 and the leftover discount
//            reduces the remainder, so the free hour's full $50 is always honored.)
//
// PURE: no DB, no next, no Date. The caller resolves the studio-local (Eastern)
// start hour and the live StudioConfig and hands them in. This file just does
// the cents math, and is covered by scripts/credit-redemption-pricing-selfcheck.ts
// which proves the four worked examples below.
//
// Worked examples (studio_b; cents; 1 credit hour):
//   1. 1hr, 11pm (late), same-day → total 8000 (6000+1000+1000), discount 5000,
//      amountDueNow 3000, remainder 0.
//   2. 1hr, 11pm, NOT same-day     → total 7000, discount 5000, amountDueNow 2000,
//      remainder 0.
//   3. 1hr, 2pm, not same-day, 1 guest → total 6000, discount 5000, amountDueNow 1000,
//      remainder 0.
//   4. 3hr, 11pm, same-day → base 15000, surcharge 6000 (3×1000 late + 3×1000
//      same-day), total 21000, deposit 10500, discount 5000, amountDueNow 5500,
//      remainder 10500 (netTotal 16000).

import type { StudioConfig } from '@/lib/studio-config';
import { priceSessionFromConfig } from '@/lib/studio-config';
import type { Room } from '@/lib/constants';

/**
 * The fixed cash value of ONE free studio hour, in cents. A free hour is always
 * worth $50 (the standard base studio hour) no matter which room or duration it
 * is redeemed against — Cole's rule: "no matter what the free hour is a $50
 * value." SINGLE SOURCE OF TRUTH: the /book API (app/api/booking/create) and the
 * booking UI (BookingFlow) import THIS so the displayed and charged discount can
 * never drift (room-rate drift is what once showed $70 off on Studio A).
 */
export const FREE_HOUR_VALUE_CENTS = 5000;

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
  // A free hour is a FLAT $50 (FREE_HOUR_VALUE_CENTS) per credit hour, regardless
  // of room or duration — NOT the booked room's hourly rate. (Cole's rule.)
  const discount = creditHoursApplied * FREE_HOUR_VALUE_CENTS;

  const netTotal = Math.max(0, total - discount);

  // The full standard deposit on the WHOLE total (incl. surcharges).
  const deposit = Math.round(total * (pricing.depositPercent / 100));

  let amountDueNow: number;
  let remainder: number;

  if (hours === 1) {
    // M == 1: no deposit split → pay the full discounted total (netTotal) now.
    // With a flat $50 credit, netTotal = total − 50: just the surcharges when the
    // $50 covers the base, plus any base above $50 (e.g. the $60 single-hour
    // rate). 0 → instant confirm, no Stripe.
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
