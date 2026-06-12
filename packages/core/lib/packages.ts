// lib/packages.ts
//
// Pricing math + payout previews for the packages & memberships system.
// Single source of truth so the calculator UI, mutation endpoints, and
// future redemption code all compute identical numbers. The calculator's
// preview line ("studio nets $X after worker payout and discount loss")
// uses these exact functions.
//
// Cole's locked-in rules encoded here:
//   • Studio B rate is the universal valuation baseline for studio_hours
//     ($50/hr in cents). Studio A / Sweet 4 / surcharge differentials
//     are paid at booking, never folded into package valuation.
//   • Workers get full-rate payout regardless of the package's discount.
//     Engineer = 60% of full session value. Media worker pool = 50% of
//     full media offering price. Producer = 60% of full beat license
//     price. The studio absorbs every dollar of discount.
//   • Discount loss = (sum of full retail) − (selling price). Tracked
//     so the accounting view can answer "how much margin did we
//     sacrifice this period?"

import {
  PRICING,
  ENGINEER_SESSION_SPLIT,
  MEDIA_WORKER_TOTAL,
  PRODUCER_COMMISSION,
  BEAT_LICENSES,
} from '@/lib/constants';

// Studio B 2+ hour rate, in cents. The rest of the platform uses
// PRICING.studioB; we re-export with a package-context name for clarity.
export const PACKAGE_HOUR_VALUE_CENTS = PRICING.studioB; // 5000 = $50

// Default beat-credit valuation. Admin can override per template line.
// Pre-loaded with the trackout lease price since that's the most-common
// purchase target for buyers using credits.
export const DEFAULT_BEAT_CREDIT_VALUE_CENTS = BEAT_LICENSES.trackout_lease.defaultPrice; // 7499

export type PackageLineKind = 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';

export interface PackageLineInput {
  kind: PackageLineKind;
  quantity: number;
  /** For media_offering kind: the offering's price_cents (already × quantity). */
  full_price_cents: number;
  /** Optional override of the line's contribution to the package selling price. */
  package_value_cents?: number;
  /** For media_offering kind: which offering (FK). Null otherwise. */
  media_offering_id?: string | null;
  /** Free-text label/description (required for `custom`, optional otherwise). */
  notes?: string | null;
}

export interface PackageMathResult {
  totalFullPriceCents: number;
  totalPackageValueCents: number;
  /** sellingPrice − totalPackageValueCents. May be negative if admin oversold. */
  customPriceDeltaCents: number;
  /** totalFullPriceCents − sellingPrice. Always ≥ 0; the studio's discount absorption. */
  totalDiscountCents: number;
  /** Discount as a fraction of retail (0..1). */
  discountPct: number;
}

/**
 * Recommend a default `package_value_cents` for a single line: the line's
 * full retail price. The calculator pre-fills with this; admin can edit
 * to redistribute value across lines for marketing reasons (e.g. "we want
 * the music video to feel premium, weight more value into it").
 */
export function defaultPackageValueForLine(line: PackageLineInput): number {
  return line.full_price_cents;
}

/**
 * Compute the rolled-up math for a list of lines + a target selling price.
 *
 * `sellingPriceCents` is the customer-facing total: one-off → total once,
 * membership → per-month × months. Caller is responsible for passing the
 * "total contract value" shape that makes sense for the comparison.
 */
export function computePackageMath(
  lines: PackageLineInput[],
  sellingPriceCents: number,
): PackageMathResult {
  const totalFullPriceCents = lines.reduce((s, l) => s + (l.full_price_cents || 0), 0);
  const totalPackageValueCents = lines.reduce(
    (s, l) => s + (l.package_value_cents ?? defaultPackageValueForLine(l)),
    0,
  );
  const customPriceDeltaCents = sellingPriceCents - totalPackageValueCents;
  const totalDiscountCents = Math.max(0, totalFullPriceCents - sellingPriceCents);
  const discountPct = totalFullPriceCents > 0
    ? totalDiscountCents / totalFullPriceCents
    : 0;
  return {
    totalFullPriceCents,
    totalPackageValueCents,
    customPriceDeltaCents,
    totalDiscountCents,
    discountPct,
  };
}

export interface WorkerPayoutPreview {
  /** Engineer take across all studio_hours lines, at full Studio B rate × split. */
  engineerCents: number;
  /** Producer take across all beat_credit lines, at full beat license × split. */
  producerCents: number;
  /** Media worker pool across all media_offering lines, at full retail × split. */
  mediaWorkerCents: number;
  /** Sum of all three; the cost the studio commits to pay regardless of discount. */
  totalCents: number;
}

/**
 * Project the worker payout cost if the entire basket is fully redeemed.
 *
 * This is a *worst-case* projection from the studio's perspective — every
 * line is consumed, so every worker share is paid. Real-world redemption
 * may be partial (entitlement expires with leftovers), in which case
 * unredeemed pieces become forfeit revenue and the actual payout drops.
 *
 * The preview gives admin the floor for "how much will I owe in payroll
 * if the customer maximally uses what I sold them?"
 */
export function computeWorkerPayoutPreview(lines: PackageLineInput[]): WorkerPayoutPreview {
  let engineerCents = 0;
  let producerCents = 0;
  let mediaWorkerCents = 0;

  for (const line of lines) {
    if (line.kind === 'studio_hours') {
      // Engineer earns 60% of the full session value at Studio B rate,
      // regardless of how the package was discounted to the customer.
      const fullValueCents = line.quantity * PACKAGE_HOUR_VALUE_CENTS;
      engineerCents += Math.round(fullValueCents * ENGINEER_SESSION_SPLIT);
    } else if (line.kind === 'beat_credit') {
      // Producer earns 60% of the beat's full license price (line.full_price_cents
      // already represents quantity × per-beat retail).
      producerCents += Math.round(line.full_price_cents * PRODUCER_COMMISSION);
    } else if (line.kind === 'media_offering') {
      // Worker pool gets 50% of the offering's full retail. (The 15%
      // sales commission is also a worker payout but is typically the
      // admin who created the package, so we omit it from the preview
      // — that money flows back to the same person we're showing this
      // calculator to.)
      mediaWorkerCents += Math.round(line.full_price_cents * MEDIA_WORKER_TOTAL);
    }
    // 'custom' kind: no payout assumption — admin describes it in notes.
  }

  return {
    engineerCents,
    producerCents,
    mediaWorkerCents,
    totalCents: engineerCents + producerCents + mediaWorkerCents,
  };
}

export interface StudioMarginPreview {
  /** Customer-facing total revenue for this package (single payment if
   *  one-off, total of all monthly invoices if membership). */
  grossRevenueCents: number;
  /** Worker payroll cost at full redemption. */
  workerPayoutCents: number;
  /** What the studio takes home if every line is redeemed. */
  studioNetCents: number;
  /** What we'd be making at retail (zero discount). */
  retailEquivalentNetCents: number;
  /** The dollar amount of margin sacrificed for this package. */
  studioMarginLossVsRetailCents: number;
  /** Selling price below which the studio would lose money on full redemption. */
  breakEvenPriceCents: number;
}

/**
 * Project studio take-home + margin loss given a basket and selling price.
 *
 * `grossRevenueCents` is computed by the caller — for one-offs it's the
 * sale price; for memberships it's `monthly_price × months` (full
 * contract value).
 */
export function computeStudioMarginPreview(
  lines: PackageLineInput[],
  grossRevenueCents: number,
): StudioMarginPreview {
  const workerPayout = computeWorkerPayoutPreview(lines);
  const math = computePackageMath(lines, grossRevenueCents);
  const studioNet = grossRevenueCents - workerPayout.totalCents;
  // What we'd net at zero discount: full retail − full worker payout.
  const retailEquivalentNet = math.totalFullPriceCents - workerPayout.totalCents;
  // Below this number, our studio share goes negative (we'd literally pay
  // workers more than the customer paid us). Pure floor.
  const breakEvenPrice = workerPayout.totalCents;
  return {
    grossRevenueCents,
    workerPayoutCents: workerPayout.totalCents,
    studioNetCents: studioNet,
    retailEquivalentNetCents: retailEquivalentNet,
    studioMarginLossVsRetailCents: retailEquivalentNet - studioNet,
    breakEvenPriceCents: breakEvenPrice,
  };
}

/**
 * Display helper. Convert cents → "$1,234.50".
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Display helper for percentages. 0.235 → "23%".
 */
export function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
