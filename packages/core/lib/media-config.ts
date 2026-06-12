// lib/media-config.ts
//
// Configurator math + snapshot types for the Media Booking Hub. The wizard
// in `components/media/MediaConfigurator.tsx` walks each slot in
// `offering.components.slots[]` and writes a `ConfiguredComponents` object
// that captures the buyer's choices. From that snapshot we can recompute the
// price deterministically — both client-side (preview) and server-side
// (Stripe `unit_amount`).
//
// **Trust boundary:** the client-side preview is for display only. The
// server-side recompute in `app/api/media/checkout/route.ts` is the only
// price that can hit Stripe. If a buyer tampers with the wizard state the
// server still bills the correct number.
//
// Pure module — safe to import from client and server. NO Supabase, NO
// next/headers.

import type { MediaOffering, OfferingComponentSlot } from './media';

// ============================================================
// Snapshot type — what the wizard produces and what we store
// ============================================================

/**
 * Per-slot decision the buyer made. We only store the *non-default* parts
 * so the snapshot stays compact in Stripe metadata (500-char per-field limit).
 *
 *   • `skipped: true`   — buyer chose to skip this skippable slot
 *   • `tier: 'premium'` — buyer chose a non-base severity tier
 *
 * Both can be present in theory, but our UI never offers a "skip + tier"
 * combo — skipping ends the slot's contribution. The recompute treats
 * `skipped` as terminal: skipped slots ignore tier entirely.
 */
export interface SlotChoice {
  skipped?: boolean;
  /** When set, must match one of the slot's `options[].tier` values. */
  tier?: string;
}

/**
 * Buyer's choices across all configurable slots, keyed by `slot.key`. Slots
 * with no decision (default tier, not skipped) are omitted to keep the JSON
 * small. Recompute treats missing keys as "default everything."
 */
export interface ConfiguredComponents {
  selections: Record<string, SlotChoice>;
}

// ============================================================
// Predicates / helpers
// ============================================================

/**
 * Does this offering need the configurator wizard? True if it has any slot
 * the buyer can change — skippable OR has severity options. Slots that are
 * pure `included`/`flexible`/`on_shoot` informational rows don't need a
 * decision and don't make an offering "configurable."
 *
 * Returns false for offerings with `components: null` (standalones,
 * Sweet Spot Band, etc).
 */
export function isOfferingConfigurable(
  offering: Pick<MediaOffering, 'components'>,
): boolean {
  const slots = offering.components?.slots;
  if (!slots || slots.length === 0) return false;
  return slots.some(
    (s) => s.skippable === true || (s.options && s.options.length > 0),
  );
}

/**
 * Return only the slots that require a decision from the buyer. The wizard
 * iterates these. Display-only slots (`included`, `on_shoot`, etc) get
 * shown in a "what else is in the package" recap instead of as steps.
 */
export function getDecisionSlots(
  slots: OfferingComponentSlot[],
): OfferingComponentSlot[] {
  return slots.filter(
    (s) => s.skippable === true || (s.options && s.options.length > 0),
  );
}

/**
 * Inverse — slots that are baked into the package and don't take input.
 * Useful for the "also included" panel.
 */
export function getInformationalSlots(
  slots: OfferingComponentSlot[],
): OfferingComponentSlot[] {
  return slots.filter(
    (s) => !(s.skippable === true || (s.options && s.options.length > 0)),
  );
}

// ============================================================
// Price recompute — the canonical math
// ============================================================

/**
 * Compute the final price for an offering + buyer config. Used for both
 * the client preview and the server-side checkout recompute. The math:
 *
 *   final = base_price
 *         − Σ (skip_delta_cents) for every slot the buyer skipped
 *         + Σ (option.delta)     for every slot tier the buyer chose
 *
 * If the offering has no fixed `price_cents` (range or inquire), this
 * function returns `null` — the configurator never applies to those.
 *
 * Side note: a tier with `delta: 0` is the implicit default (e.g. "basic").
 * If the buyer doesn't pick a tier, we treat the lowest-delta option as
 * chosen so the price math is stable regardless of UI default state.
 */
export function computeConfiguredPriceCents(
  offering: Pick<MediaOffering, 'price_cents' | 'components'>,
  config: ConfiguredComponents,
): number | null {
  if (offering.price_cents == null) return null;

  let total = offering.price_cents;
  const slots = offering.components?.slots ?? [];

  for (const slot of slots) {
    const choice = config.selections[slot.key];

    // Skipped: subtract skip delta and move on. Tier is ignored.
    if (choice?.skipped && slot.skippable && slot.skip_delta_cents) {
      total -= slot.skip_delta_cents;
      continue;
    }

    // Tiered: add the chosen tier's delta. Default to the lowest-delta
    // option if no choice was made.
    if (slot.options && slot.options.length > 0) {
      const sorted = [...slot.options].sort((a, b) => a.delta - b.delta);
      const defaultTier = sorted[0]!.tier;
      const tier = choice?.tier ?? defaultTier;
      const opt = slot.options.find((o) => o.tier === tier);
      if (opt) total += opt.delta;
    }
  }

  return total;
}

// ============================================================
// Validation — used by the checkout API to defend against tampering
// ============================================================

/**
 * Sanity-check a `ConfiguredComponents` snapshot against an offering. The
 * checkout API runs this before recomputing the price. Returns an error
 * message string if anything's off (skipped a non-skippable slot, picked
 * a tier that doesn't exist, etc), or `null` if valid.
 *
 * We're permissive about MISSING keys — if the buyer didn't make a choice
 * for a slot, the recompute uses the default. We're strict about INVALID
 * keys to surface front-end bugs.
 */
export function validateConfig(
  offering: Pick<MediaOffering, 'components'>,
  config: ConfiguredComponents,
): string | null {
  const slots = offering.components?.slots ?? [];
  const slotMap = new Map(slots.map((s) => [s.key, s]));

  for (const [key, choice] of Object.entries(config.selections)) {
    const slot = slotMap.get(key);
    if (!slot) {
      return `Unknown slot "${key}" in configuration`;
    }
    if (choice.skipped && !slot.skippable) {
      return `Slot "${key}" is not skippable`;
    }
    if (choice.tier) {
      const valid = slot.options?.some((o) => o.tier === choice.tier);
      if (!valid) {
        return `Invalid tier "${choice.tier}" for slot "${key}"`;
      }
    }
  }

  return null;
}

/**
 * Render a config snapshot as a list of human-readable strings for emails
 * and the post-purchase recap. Each line describes the chosen state of a
 * decision slot (default tier or "skipped" or "premium tier").
 *
 * Informational slots are NOT included — the caller decides whether to
 * append them under a separate "also included" header.
 */
export function describeConfig(
  offering: Pick<MediaOffering, 'components'>,
  config: ConfiguredComponents,
): string[] {
  const lines: string[] = [];
  const slots = offering.components?.slots ?? [];

  for (const slot of slots) {
    if (!(slot.skippable || (slot.options && slot.options.length > 0))) continue;
    const choice = config.selections[slot.key];

    if (choice?.skipped) {
      lines.push(`${slot.label} — skipped`);
      continue;
    }

    if (slot.options && slot.options.length > 0) {
      const sorted = [...slot.options].sort((a, b) => a.delta - b.delta);
      const defaultTier = sorted[0]!.tier;
      const tier = choice?.tier ?? defaultTier;
      lines.push(`${slot.label} — ${tier}`);
      continue;
    }

    // Skippable but kept (no tiers)
    lines.push(`${slot.label} — included`);
  }

  return lines;
}

/**
 * The empty / all-defaults config — what a fresh wizard starts with and
 * what we ship to checkout when the buyer hits "Buy at base price" instead
 * of touching anything.
 */
export const EMPTY_CONFIG: ConfiguredComponents = { selections: {} };
