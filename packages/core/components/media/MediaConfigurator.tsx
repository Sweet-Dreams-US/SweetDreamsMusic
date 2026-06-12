'use client';

// components/media/MediaConfigurator.tsx
//
// Multi-step wizard that walks the buyer through every *decision* slot on a
// package offering. One step per slot + a final review step. Live price
// preview in the header so the math is transparent at every choice.
//
// Trust model: we compute and display a price client-side for UX, but the
// actual Stripe `unit_amount` comes from a server-side recompute in
// `/api/media/checkout`. Tampering with this component's state changes
// what the user *sees*, never what they *pay*.
//
// Why a wizard vs. a single tall form: Cole's spec calls for slot-by-slot
// guidance. On mobile a long form becomes a scroll trap; on desktop the
// stepper makes the math feel like a conversation rather than a quote
// builder. Trade-off: a few extra clicks vs. clearer reasoning.

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, X, Sparkles } from 'lucide-react';
import type { MediaOffering, OfferingComponentSlot } from '@/lib/media';
import {
  type ConfiguredComponents,
  type SlotChoice,
  computeConfiguredPriceCents,
  describeConfig,
  getDecisionSlots,
  getInformationalSlots,
} from '@/lib/media-config';

function fmt(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtDelta(cents: number): string {
  if (cents === 0) return 'included';
  const sign = cents > 0 ? '+' : '−';
  return `${sign}${fmt(Math.abs(cents))}`;
}

export default function MediaConfigurator({ offering }: { offering: MediaOffering }) {
  const router = useRouter();
  const [config, setConfig] = useState<ConfiguredComponents>({ selections: {} });
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decisionSlots = useMemo(
    () => getDecisionSlots(offering.components?.slots ?? []),
    [offering],
  );
  const informationalSlots = useMemo(
    () => getInformationalSlots(offering.components?.slots ?? []),
    [offering],
  );

  // Steps: one per decision slot, then review at the end.
  const totalSteps = decisionSlots.length + 1;
  const isReview = stepIdx === decisionSlots.length;
  const currentSlot = decisionSlots[stepIdx];

  const previewPrice = useMemo(
    () => computeConfiguredPriceCents(offering, config),
    [offering, config],
  );

  const setChoice = (slotKey: string, choice: SlotChoice) => {
    setConfig((prev) => ({
      selections: { ...prev.selections, [slotKey]: choice },
    }));
  };

  // Has the buyer made an explicit decision for this slot? Used to gate
  // the "Next" button — we don't auto-advance them past skippable slots
  // until they say yes/no, because the default isn't always obvious.
  const hasDecided = (slot: OfferingComponentSlot): boolean => {
    const c = config.selections[slot.key];
    if (!c) {
      // No choice yet. For tier-only slots (no skip) we accept the implicit
      // default; the buyer can still change it. For skippable slots we
      // require an explicit yes/no.
      return !slot.skippable;
    }
    if (slot.skippable && c.skipped !== undefined) return true;
    if (slot.options && c.tier) return true;
    // Skippable slot where they chose to keep (skipped: false) but no tier:
    // also a decision.
    if (slot.skippable && c.skipped === false) return true;
    return false;
  };

  const canAdvance = !currentSlot || hasDecided(currentSlot);

  function submit() {
    // Round 3b: instead of going straight to checkout, hand off to the
    // project-details page. We stash the configurator snapshot in
    // sessionStorage under a slug-keyed key — the details form picks it
    // up and includes it in the eventual checkout POST. Keeping the
    // payload off the URL keeps the address bar clean and side-steps the
    // size cap on Stripe metadata for partially-encoded JSON.
    setSubmitting(true);
    setError(null);
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          `media-config:${offering.slug}`,
          JSON.stringify(config),
        );
      }
      router.push(`/dashboard/media/${offering.slug}/details`);
    } catch (err) {
      console.error('[media-configurator] handoff error:', err);
      setError('Could not save your selections — try again.');
      setSubmitting(false);
    }
  }

  return (
    <section className="bg-white text-black min-h-[80vh]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header — title + live price preview */}
        <div className="mb-10">
          <p className="font-mono text-xs uppercase tracking-wider text-black/50 mb-2">
            Configure your package
          </p>
          <h1 className="text-heading-xl mb-3">{offering.title}</h1>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-wider text-black/50">
              Total
            </span>
            <span className="text-3xl font-bold tracking-tight">
              {previewPrice != null ? fmt(previewPrice) : '—'}
            </span>
            {previewPrice != null && offering.price_cents != null && previewPrice !== offering.price_cents && (
              <span className="font-mono text-xs text-black/40">
                base {fmt(offering.price_cents)}
              </span>
            )}
          </div>
        </div>

        {/* Stepper — numeric, no fancy SVG */}
        <div className="flex items-center gap-2 mb-8">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 ${
                i < stepIdx
                  ? 'bg-accent'
                  : i === stepIdx
                  ? 'bg-black'
                  : 'bg-black/10'
              }`}
              aria-label={`Step ${i + 1} of ${totalSteps}`}
            />
          ))}
        </div>
        <p className="font-mono text-[11px] uppercase tracking-wider text-black/40 mb-8">
          Step {stepIdx + 1} of {totalSteps}
          {isReview ? ' — Review' : currentSlot ? ` — ${currentSlot.label}` : ''}
        </p>

        {/* Step body */}
        {!isReview && currentSlot && (
          <SlotStep
            slot={currentSlot}
            choice={config.selections[currentSlot.key]}
            onChoose={(c) => setChoice(currentSlot.key, c)}
          />
        )}

        {isReview && (
          <ReviewStep
            offering={offering}
            config={config}
            informationalSlots={informationalSlots}
            previewPrice={previewPrice ?? offering.price_cents ?? 0}
          />
        )}

        {/* Error */}
        {error && (
          <div className="mt-6 p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
            {error}
          </div>
        )}

        {/* Footer nav */}
        <div className="flex items-center justify-between mt-10 pt-6 border-t border-black/10">
          <button
            type="button"
            onClick={() => {
              if (stepIdx === 0) {
                router.push(`/dashboard/media/${offering.slug}`);
              } else {
                setStepIdx(stepIdx - 1);
              }
            }}
            className="font-mono text-xs font-bold uppercase tracking-wider text-black/60 hover:text-black inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-3 h-3" />
            {stepIdx === 0 ? 'Back to offering' : 'Previous'}
          </button>

          {!isReview && (
            <button
              type="button"
              disabled={!canAdvance}
              onClick={() => setStepIdx(stepIdx + 1)}
              className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {stepIdx === decisionSlots.length - 1 ? 'Review' : 'Next'}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}

          {isReview && (
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent/90 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : `Continue · ${fmt(previewPrice ?? offering.price_cents ?? 0)}`}
              {!submitting && <ArrowRight className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Step renderer — handles skippable, tiered, or skippable+tiered
// ============================================================

function SlotStep({
  slot,
  choice,
  onChoose,
}: {
  slot: OfferingComponentSlot;
  choice: SlotChoice | undefined;
  onChoose: (c: SlotChoice) => void;
}) {
  const tierOpts = slot.options ?? [];
  const sortedTiers = [...tierOpts].sort((a, b) => a.delta - b.delta);
  const isSkipped = choice?.skipped === true;
  const tierChosen = choice?.tier ?? sortedTiers[0]?.tier;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">{slot.label}</h2>
        {slot.skippable && slot.skip_delta_cents ? (
          <p className="font-mono text-xs text-black/50">
            Skip this and save {fmt(slot.skip_delta_cents)}.
          </p>
        ) : tierOpts.length > 0 ? (
          <p className="font-mono text-xs text-black/50">
            Choose your level. The base tier is included; upgrades add to your total.
          </p>
        ) : null}
      </div>

      {/* Skippable: yes/skip toggle */}
      {slot.skippable && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() =>
              onChoose({
                skipped: false,
                ...(tierChosen ? { tier: tierChosen } : {}),
              })
            }
            className={`p-5 text-left border-2 transition-colors ${
              !isSkipped && choice
                ? 'border-accent bg-accent/10'
                : 'border-black/10 hover:border-black/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[11px] uppercase tracking-wider font-bold">
                Include
              </span>
              <Check className="w-4 h-4 text-black/40" />
            </div>
            <p className="text-sm">Keep this in the package.</p>
          </button>
          <button
            type="button"
            onClick={() => onChoose({ skipped: true })}
            className={`p-5 text-left border-2 transition-colors ${
              isSkipped
                ? 'border-accent bg-accent/10'
                : 'border-black/10 hover:border-black/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[11px] uppercase tracking-wider font-bold">
                Skip
              </span>
              <X className="w-4 h-4 text-black/40" />
            </div>
            <p className="text-sm">
              Drop this and save{' '}
              <strong>{fmt(slot.skip_delta_cents ?? 0)}</strong>.
            </p>
          </button>
        </div>
      )}

      {/* Tier picker — disabled if skipped, hidden if no tiers */}
      {tierOpts.length > 0 && !isSkipped && (
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mt-4">
            Production level
          </p>
          {sortedTiers.map((opt) => {
            const selected = (tierChosen ?? sortedTiers[0]?.tier) === opt.tier;
            return (
              <button
                key={opt.tier}
                type="button"
                onClick={() =>
                  onChoose({
                    tier: opt.tier,
                    ...(slot.skippable ? { skipped: false } : {}),
                  })
                }
                className={`w-full p-4 text-left border-2 transition-colors flex items-center justify-between ${
                  selected
                    ? 'border-accent bg-accent/10'
                    : 'border-black/10 hover:border-black/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  {opt.tier === 'premium' && <Sparkles className="w-4 h-4 text-accent" />}
                  <span className="font-bold capitalize">{opt.tier}</span>
                </div>
                <span className="font-mono text-sm font-bold">
                  {fmtDelta(opt.delta)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Review step — recap of decisions + what else is included
// ============================================================

function ReviewStep({
  offering,
  config,
  informationalSlots,
  previewPrice,
}: {
  offering: MediaOffering;
  config: ConfiguredComponents;
  informationalSlots: OfferingComponentSlot[];
  previewPrice: number;
}) {
  const decisionLines = describeConfig(offering, config);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2">Review your build</h2>
        <p className="font-mono text-xs text-black/50">
          Confirm your selections, then we&apos;ll route you to secure checkout.
        </p>
      </div>

      {decisionLines.length > 0 && (
        <div className="bg-black text-white p-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-white/50 mb-3">
            Your selections
          </p>
          <ul className="space-y-2">
            {decisionLines.map((line, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {informationalSlots.length > 0 && (
        <div className="border border-black/10 p-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
            Also included
          </p>
          <ul className="space-y-1.5">
            {informationalSlots.map((slot) => (
              <li key={slot.key} className="text-sm text-black/70">
                · {slot.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-baseline justify-between border-t border-black/10 pt-6">
        <span className="font-mono text-xs uppercase tracking-wider text-black/50">
          Total
        </span>
        <span className="text-4xl font-bold tracking-tight">{fmt(previewPrice)}</span>
      </div>

      <p className="font-mono text-[11px] text-black/40">
        Full payment processed now. Studio recording hours included in this package land in your prepaid balance — schedule them whenever you&apos;re ready.
      </p>
    </div>
  );
}
