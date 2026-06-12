'use client';

// components/media/MediaShowcaseCard.tsx
//
// Interactive card for the public /media page (and reused on /dashboard/media
// once the dashboard adopts the same visual). Two states:
//
//   • Resting   — title + short blurb (the "explanation")
//   • Expanded  — title + bulleted list of what the package includes
//
// Trigger:
//   • Desktop / hover-capable devices  →  CSS hover (`group-hover`)
//   • Touch devices (no hover)         →  IntersectionObserver fires when the
//                                         card is in the middle of the viewport
//
// We feature-detect via `(hover: none)` rather than viewport width so a
// touchscreen laptop behaves correctly. Both triggers update the SAME class
// (`is-expanded`), so the CSS only needs one selector.

import { useEffect, useRef, useState } from 'react';

interface Variant {
  /** Outer card border + bg classes */
  card: string;
  /** Heading text class */
  heading: string;
  /** Blurb text class */
  blurb: string;
  /** Expanded panel bg + text */
  expanded: string;
  /** Bullet list item class */
  item: string;
  /** Item-divider color (Tailwind utility for border) */
  divider: string;
}

const VARIANTS: Record<'dark' | 'light', Variant> = {
  dark: {
    card: 'bg-white/[0.04] border-white/15 hover:border-accent text-white',
    heading: 'text-white',
    blurb: 'text-white/70',
    expanded: 'bg-black/40 text-white',
    item: 'text-white/85',
    divider: 'border-white/10',
  },
  light: {
    card: 'bg-white border-black/15 hover:border-black text-black',
    heading: 'text-black',
    blurb: 'text-black/65',
    expanded: 'bg-black/[0.03] text-black',
    item: 'text-black/85',
    divider: 'border-black/10',
  },
};

export default function MediaShowcaseCard({
  title,
  blurb,
  items,
  variant = 'dark',
  size = 'md',
}: {
  title: string;
  blurb: string | null;
  /** Bullet items shown in the expanded state. If empty, the panel still
   *  renders but with a "tap for details inside the dashboard" hint. */
  items: string[];
  variant?: 'dark' | 'light';
  /** Used for the standalone "à la carte" cards which want tighter spacing */
  size?: 'sm' | 'md';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    // Only attach the observer on touch devices. Desktop relies on CSS hover
    // — attaching on desktop would cause weird "auto-expand as you scroll"
    // behavior that fights with the user's mouse intent.
    const isTouch = window.matchMedia('(hover: none)').matches;
    if (!isTouch || !('IntersectionObserver' in window)) return;

    const obs = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      {
        // Shrink the root by 35% top + bottom so a card only counts as "in
        // view" when it's in the middle ~30% of the viewport. Feels like
        // "the user is looking at this card right now."
        rootMargin: '-35% 0px -35% 0px',
        threshold: 0,
      },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const v = VARIANTS[variant];
  const padding = size === 'sm' ? 'p-5 sm:p-6' : 'p-6 sm:p-8';
  const titleSize = size === 'sm'
    ? 'font-mono text-base font-bold uppercase tracking-wider'
    : 'text-heading-md';

  return (
    <div
      ref={ref}
      data-active={active ? 'true' : 'false'}
      className={`group/card relative border-2 transition-colors flex flex-col ${v.card} ${padding}`}
    >
      <h3 className={`${titleSize} mb-2 ${v.heading}`}>{title}</h3>
      {blurb && (
        <p className={`font-mono text-sm leading-relaxed ${v.blurb} flex-grow`}>
          {blurb}
        </p>
      )}

      {/* Expanded list — collapsed by default, expanded on hover OR when
          marked active by IntersectionObserver. The transition uses
          max-height + opacity since `display:none` isn't animatable. */}
      {items.length > 0 && (
        <div
          className={`
            mt-3 overflow-hidden transition-all duration-300 ease-out
            max-h-0 opacity-0
            group-hover/card:max-h-[600px] group-hover/card:opacity-100
            data-[active=true]:max-h-[600px] data-[active=true]:opacity-100
          `}
        >
          <div className={`pt-3 mt-1 border-t ${v.divider}`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] mb-2 opacity-60">
              What&apos;s included
            </p>
            <ul className="space-y-1.5">
              {items.map((item, i) => (
                <li
                  key={i}
                  className={`font-mono text-xs leading-snug flex items-start gap-2 ${v.item}`}
                >
                  <span aria-hidden className="text-accent mt-0.5 shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
