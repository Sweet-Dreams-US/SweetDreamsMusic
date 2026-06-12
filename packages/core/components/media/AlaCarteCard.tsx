'use client';

// components/media/AlaCarteCard.tsx
//
// Inline-expandable à la carte tile for the new /dashboard/media cart UX.
// Simpler than PackageCard since standalones have no slot configuration —
// just an expanded view with project details and an Add-to-Cart button.
//
// Multiple à la carte items can be added — same offering can be added
// multiple times (each with its own project details, e.g. "short for
// Song A" + "short for Song B"). The cart context generates a fresh
// UUID per add so the entries don't collide.

import { useState } from 'react';
import { ChevronDown, ChevronUp, ShoppingCart, Check } from 'lucide-react';
import type { MediaOffering } from '@/lib/media';
import { EMPTY_PROJECT_DETAILS, type MediaProjectDetails } from '@/lib/media-cart';
import { useMediaCart } from './MediaCartContext';
import MediaInlineProjectDetails from './MediaInlineProjectDetails';

function fmt(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function AlaCarteCard({
  offering,
  isExpanded,
  onToggle,
}: {
  offering: MediaOffering;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cart = useMediaCart();
  const [details, setDetails] = useState<MediaProjectDetails>({ ...EMPTY_PROJECT_DETAILS });
  const [justAdded, setJustAdded] = useState(false);

  const isInquireOnly = offering.price_cents == null;
  const isPriceRange =
    offering.price_range_low_cents != null && offering.price_range_high_cents != null;
  const isBuyable = !isInquireOnly && !isPriceRange;

  function addToCart() {
    cart.addItem({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      offering,
      projectDetails: details,
      computedPriceCents: offering.price_cents ?? 0,
    });
    setJustAdded(true);
    setTimeout(() => {
      setJustAdded(false);
      setDetails({ ...EMPTY_PROJECT_DETAILS });
      onToggle(); // collapse
    }, 900);
  }

  return (
    <li
      className={`border-2 transition-colors ${
        isExpanded ? 'border-accent' : 'border-black/10 hover:border-black/30'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 sm:p-5 flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-1">
            {offering.title}
          </h3>
          {!isExpanded && offering.public_blurb && (
            <p className="font-mono text-xs text-black/55 line-clamp-2">
              {offering.public_blurb}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <p className="font-mono text-base font-bold text-accent">
            {isBuyable
              ? fmt(offering.price_cents!)
              : isPriceRange
              ? `${fmt(offering.price_range_low_cents!)}–${fmt(offering.price_range_high_cents!)}`
              : 'Inquire'}
          </p>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-black/50" />
          ) : (
            <ChevronDown className="w-4 h-4 text-black/50" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-black/10 pt-4 space-y-4">
          {offering.public_blurb && (
            <p className="font-mono text-xs text-black/65">{offering.public_blurb}</p>
          )}

          {/* Buyable: project details (all optional) + add to cart */}
          {isBuyable && (
            <>
              <MediaInlineProjectDetails value={details} onChange={setDetails} />
              <p className="font-mono text-[11px] text-black/55">
                <strong className="text-black">50% deposit</strong> charged at checkout.
                We&apos;ll call to plan the rest.
              </p>
              <button
                type="button"
                onClick={addToCart}
                className={`w-full font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 inline-flex items-center justify-center gap-2 transition-colors ${
                  justAdded
                    ? 'bg-green-600 text-white'
                    : 'bg-accent text-black hover:bg-accent/90'
                }`}
              >
                {justAdded ? (
                  <>
                    <Check className="w-3 h-3" /> Added
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-3 h-3" />
                    Add to cart · {fmt(offering.price_cents!)}
                  </>
                )}
              </button>
            </>
          )}

          {/* Range / inquire — push to inquiry form */}
          {!isBuyable && (
            <a
              href={`/dashboard/media/${offering.slug}/inquire`}
              className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 no-underline"
            >
              Send an inquiry
            </a>
          )}
        </div>
      )}
    </li>
  );
}
