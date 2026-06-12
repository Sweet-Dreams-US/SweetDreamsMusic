'use client';

// components/media/PackageCard.tsx
//
// Inline-expandable package tile for the new /dashboard/media cart UX.
// Three visual states:
//
//   1. Resting   — title + price + "Tap to see what's included"
//   2. Includes  — adds a bulleted list of deliverables (slot labels) +
//                  "Build & Add to Cart" button (configurable) or
//                  "Add to Cart" with project details (non-configurable)
//   3. Building  — adds the inline configurator (per-slot choices with
//                  live price) + project details form + "Add to Cart"
//
// State is local to the card. Only the cart context is shared. This means
// the user can have one card expanded at a time (the parent collapses
// siblings via `isExpanded` + `onToggle` props).
//
// Why all-in-one card vs. hand-off-to-separate-page: the user wanted the
// flow to stay on the same page so they can add multiple packages /
// pieces to a cart and check out once. Pages were a step backwards from
// that pattern.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Settings2, ShoppingCart, Check } from 'lucide-react';
import type { MediaOffering, OfferingComponentSlot } from '@/lib/media';
import {
  type ConfiguredComponents,
  computeConfiguredPriceCents,
  describeConfig,
  getDecisionSlots,
  getInformationalSlots,
  isOfferingConfigurable,
} from '@/lib/media-config';
import { EMPTY_PROJECT_DETAILS, type MediaProjectDetails } from '@/lib/media-cart';
import { useMediaCart } from './MediaCartContext';
import MediaInlineProjectDetails from './MediaInlineProjectDetails';

function fmt(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(cents / 100);
}
function fmtDelta(cents: number): string {
  if (cents === 0) return 'included';
  return `${cents > 0 ? '+' : '−'}${fmt(Math.abs(cents))}`;
}

type Mode = 'closed' | 'includes' | 'building';

export default function PackageCard({
  offering,
  isExpanded,
  onToggle,
}: {
  offering: MediaOffering;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cart = useMediaCart();
  const [mode, setMode] = useState<Mode>('closed');
  const [config, setConfig] = useState<ConfiguredComponents>({ selections: {} });
  const [details, setDetails] = useState<MediaProjectDetails>({ ...EMPTY_PROJECT_DETAILS });
  const [justAdded, setJustAdded] = useState(false);

  const configurable = isOfferingConfigurable(offering);
  const decisionSlots = useMemo(
    () => getDecisionSlots(offering.components?.slots ?? []),
    [offering],
  );
  const infoSlots = useMemo(
    () => getInformationalSlots(offering.components?.slots ?? []),
    [offering],
  );
  const previewPrice = useMemo(
    () => computeConfiguredPriceCents(offering, config),
    [offering, config],
  );

  // Sync the card's open state with the parent's `isExpanded` — when the
  // parent collapses us, also reset to mode='closed' so re-opening starts
  // fresh on the includes view.
  if (!isExpanded && mode !== 'closed') {
    setMode('closed');
  }

  function openIncludes() {
    onToggle();
    setMode(isExpanded ? 'closed' : 'includes');
  }

  function startBuilding() {
    setMode('building');
  }

  function addToCart() {
    cart.addItem({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      offering,
      configuredComponents: configurable ? config : undefined,
      projectDetails: details,
      computedPriceCents: previewPrice ?? offering.price_cents ?? 0,
    });
    // Success flash → reset state → collapse the card so the user can
    // pick another offering or scroll to the cart.
    setJustAdded(true);
    setTimeout(() => {
      setJustAdded(false);
      setMode('closed');
      setConfig({ selections: {} });
      setDetails({ ...EMPTY_PROJECT_DETAILS });
      onToggle(); // collapse
    }, 900);
  }

  const isInquireOnly = offering.price_cents == null;
  // Round 6: validation no longer blocks add-to-cart on missing project
  // details — every field is optional. Only the offering's buyability
  // (fixed price, not inquire-only) matters for the button state.
  const buttonDisabled = isInquireOnly;

  return (
    <li
      className={`border-2 transition-colors ${
        isExpanded ? 'border-accent' : 'border-black/10 hover:border-black/30'
      }`}
    >
      {/* HEADER — always visible, click toggles */}
      <button
        type="button"
        onClick={openIncludes}
        className="w-full text-left p-5 sm:p-6 flex items-center justify-between gap-4"
      >
        <div className="min-w-0">
          <h3 className="text-heading-md mb-1">{offering.title}</h3>
          {offering.public_blurb && !isExpanded && (
            <p className="font-mono text-xs text-black/55 line-clamp-2">
              {offering.public_blurb}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {offering.price_cents != null ? (
            <p className="font-mono text-lg font-bold text-accent">
              {fmt(offering.price_cents)}
            </p>
          ) : (
            <p className="font-mono text-xs uppercase tracking-wider text-black/50">
              Inquire
            </p>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-black/50" />
          ) : (
            <ChevronDown className="w-4 h-4 text-black/50" />
          )}
        </div>
      </button>

      {/* INCLUDES VIEW — what's in the package */}
      {isExpanded && mode === 'includes' && (
        <div className="px-5 sm:px-6 pb-5 sm:pb-6 border-t border-black/10 pt-4 space-y-4">
          {offering.public_blurb && (
            <p className="font-mono text-sm text-black/65">{offering.public_blurb}</p>
          )}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-2">
              What&apos;s included
            </p>
            <ul className="space-y-1.5">
              {[...decisionSlots, ...infoSlots].map((slot) => (
                <li key={slot.key} className="font-mono text-xs flex items-start gap-2">
                  <span aria-hidden className="text-accent shrink-0">·</span>
                  <span className="text-black/80">{slot.label}</span>
                </li>
              ))}
            </ul>
          </div>
          {offering.studio_hours_included > 0 && (
            <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-accent">
              + {offering.studio_hours_included} hrs studio time → prepaid balance
            </p>
          )}
          {!isInquireOnly && (
            <button
              type="button"
              onClick={startBuilding}
              className="w-full bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent hover:text-black transition-colors inline-flex items-center justify-center gap-2"
            >
              <Settings2 className="w-3 h-3" />
              {configurable ? 'Build your package' : 'Add to cart'}
            </button>
          )}
          {isInquireOnly && (
            <a
              href={`/dashboard/media/${offering.slug}/inquire`}
              className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-3 no-underline"
            >
              Send an inquiry
            </a>
          )}
        </div>
      )}

      {/* BUILDING VIEW — configurator + project details + add-to-cart */}
      {isExpanded && mode === 'building' && (
        <div className="px-5 sm:px-6 pb-5 sm:pb-6 border-t border-black/10 pt-4 space-y-6">
          {/* Live price preview */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-black/50">
              Total so far
            </span>
            <span className="text-2xl font-bold tracking-tight">
              {previewPrice != null ? fmt(previewPrice) : '—'}
            </span>
          </div>

          {/* Per-slot decisions (only configurable offerings) */}
          {configurable && decisionSlots.length > 0 && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-3">
                Build it out
              </p>
              <div className="space-y-3">
                {decisionSlots.map((slot) => (
                  <SlotEditor
                    key={slot.key}
                    slot={slot}
                    choice={config.selections[slot.key]}
                    onChange={(choice) =>
                      setConfig((prev) => ({
                        selections: { ...prev.selections, [slot.key]: choice },
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recap of decisions for the buyer */}
          {configurable && (
            <div className="border border-black/10 p-3 bg-black/[0.02]">
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">
                Your build
              </p>
              <ul className="space-y-1">
                {describeConfig(offering, config).map((line, i) => (
                  <li key={i} className="font-mono text-[11px] text-black/70">
                    · {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Project details form. We pass the offering's slot keys so
              the form can render slot-aware mini-fields (cover art name
              when there's a cover_art slot, songs-for-shorts when there's
              a shorts slot, etc). showSongsByDefault=true because packages
              are the case where the buyer most likely wants to itemize. */}
          <MediaInlineProjectDetails
            value={details}
            onChange={setDetails}
            slotKeys={(offering.components?.slots ?? []).map((s) => s.key)}
            showSongsByDefault
          />

          {/* Deposit reminder before checkout — they're paying half now,
              we'll bill the rest after we've planned the project. */}
          <p className="font-mono text-[11px] text-black/55">
            <strong className="text-black">50% deposit</strong> charged at checkout.
            Remaining balance billed once we&apos;ve scoped your shoot dates with you.
          </p>

          <button
            type="button"
            onClick={addToCart}
            disabled={buttonDisabled}
            className={`w-full font-mono text-xs font-bold uppercase tracking-wider px-5 py-3 inline-flex items-center justify-center gap-2 transition-colors ${
              justAdded
                ? 'bg-green-600 text-white'
                : 'bg-accent text-black hover:bg-accent/90'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {justAdded ? (
              <>
                <Check className="w-3 h-3" /> Added
              </>
            ) : (
              <>
                <ShoppingCart className="w-3 h-3" />
                Add to cart · {fmt(previewPrice ?? offering.price_cents ?? 0)}
              </>
            )}
          </button>
        </div>
      )}
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SlotEditor — inline per-slot picker. Skippable shows yes/skip pair;
// tiered shows tier buttons. Mirrors the multi-step MediaConfigurator
// but flat instead of paginated, so it fits inside a card.
// ──────────────────────────────────────────────────────────────────────
function SlotEditor({
  slot,
  choice,
  onChange,
}: {
  slot: OfferingComponentSlot;
  choice: { skipped?: boolean; tier?: string } | undefined;
  onChange: (c: { skipped?: boolean; tier?: string }) => void;
}) {
  const tierOpts = [...(slot.options ?? [])].sort((a, b) => a.delta - b.delta);
  const isSkipped = choice?.skipped === true;
  const tierChosen = choice?.tier ?? tierOpts[0]?.tier;

  return (
    <div className="border border-black/10 p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="font-bold text-sm">{slot.label}</p>
        {slot.skippable && slot.skip_delta_cents ? (
          <p className="font-mono text-[10px] text-black/50 shrink-0">
            skip saves {fmt(slot.skip_delta_cents)}
          </p>
        ) : null}
      </div>
      {slot.skippable && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            onClick={() =>
              onChange({ skipped: false, ...(tierChosen ? { tier: tierChosen } : {}) })
            }
            className={`font-mono text-[11px] uppercase tracking-wider py-2 border-2 ${
              !isSkipped && choice ? 'border-accent bg-accent/10' : 'border-black/10'
            }`}
          >
            Include
          </button>
          <button
            type="button"
            onClick={() => onChange({ skipped: true })}
            className={`font-mono text-[11px] uppercase tracking-wider py-2 border-2 ${
              isSkipped ? 'border-accent bg-accent/10' : 'border-black/10'
            }`}
          >
            Skip
          </button>
        </div>
      )}
      {tierOpts.length > 0 && !isSkipped && (
        <div className="space-y-1.5">
          {tierOpts.map((opt) => {
            const selected = (tierChosen ?? tierOpts[0]?.tier) === opt.tier;
            return (
              <button
                key={opt.tier}
                type="button"
                onClick={() =>
                  onChange({ tier: opt.tier, ...(slot.skippable ? { skipped: false } : {}) })
                }
                className={`w-full px-3 py-2 text-left border-2 flex items-center justify-between transition-colors ${
                  selected ? 'border-accent bg-accent/10' : 'border-black/10 hover:border-black/30'
                }`}
              >
                <span className="font-bold capitalize text-sm">{opt.tier}</span>
                <span className="font-mono text-xs">{fmtDelta(opt.delta)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
