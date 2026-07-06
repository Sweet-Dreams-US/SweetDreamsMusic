// components/booking/MediaAddOnsSection.tsx
//
// Showcase strip rendered BELOW the session-booking flow on /book. It answers
// "what media can I add to my booking?" — music videos, shorts, photo,
// marketing, and the bundled studio packages — without leaving the booking
// page. It's a *showcase*: no prices on this public surface (same rule as the
// public /media page) and the actual booking action is login-gated.
//
// This is a SERVER component so it can read the offerings catalog directly via
// the same service-client path /book already uses (getActiveOfferings, which
// wraps createServiceClient). The interactive expand-on-hover cards reuse the
// existing client component MediaShowcaseCard, so the look matches /media
// exactly.
//
// The CTA routes to the REAL customer media flow — the Media Hub at
// /dashboard/media (browse → configure → buy). Logged-out viewers are sent to
// /login?redirect=/dashboard/media, mirroring how /book and /media gate the
// booking action behind sign-in.

import Link from 'next/link';
import { ArrowRight, Clapperboard } from 'lucide-react';
import type { SessionUser } from '@/lib/auth';
import { getActiveOfferings } from '@/lib/media-server';
import { getUserBands } from '@/lib/bands-server';
import {
  groupOfferings,
  isOfferingVisibleTo,
  viewerEligibilityFromBands,
  type OfferingComponents,
} from '@/lib/media';
import MediaShowcaseCard from '@/components/media/MediaShowcaseCard';

// Pull the human-readable slot labels out of an offering's `components` JSONB
// so the card's expanded panel can list "what's included". Standalones (no
// components) return an empty list — the card still renders, just without the
// expand panel. Same logic the /media page uses.
function slotsForOffering(
  components: OfferingComponents | null | undefined,
): string[] {
  if (!components?.slots) return [];
  return components.slots
    .map((s) => (typeof s.label === 'string' ? s.label : ''))
    .filter((l): l is string => l.length > 0);
}

export default async function MediaAddOnsSection({
  user,
}: {
  // Already resolved by the page so we don't re-fetch the session. null = the
  // viewer is logged out.
  user: SessionUser | null;
}) {
  // Derive viewer eligibility the same way /media does: solo + anonymous
  // viewers must NEVER see band-only offerings (Cole's rule). Band members see
  // everything. Reading bands for a logged-in user is a cheap query.
  const bandMemberships = user ? await getUserBands(user.id) : [];
  const viewer = viewerEligibilityFromBands({
    authenticated: !!user,
    bandCount: bandMemberships.length,
  });

  const offerings = await getActiveOfferings();
  const visible = offerings.filter((o) => isOfferingVisibleTo(o, viewer));
  const { packages, services } = groupOfferings(visible);

  // Nothing to show → render nothing. Keeps /book clean when the catalog is
  // empty or fully hidden for this viewer.
  if (packages.length === 0 && services.length === 0) return null;

  // The real customer media flow. Logged-in → straight to the Media Hub.
  // Logged-out → sign in first, then bounce to the Hub (same redirect target
  // /media uses for its sign-in CTAs).
  const ctaHref = user ? '/dashboard/media' : '/login?redirect=/dashboard/media';
  const ctaLabel = user ? 'Open the Media Hub' : 'Sign in to add media';

  return (
    <section className="bg-black text-white py-12 sm:py-20 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header — matches the /media + /book label styling */}
        <div className="flex items-center gap-3 mb-3">
          <Clapperboard className="w-5 h-5 text-accent" />
          <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase text-accent">
            Add Media To Your Session
          </p>
        </div>
        <h2 className="text-heading-xl mb-4">STUDIO MEDIA</h2>
        <p className="font-mono text-body-sm text-white/70 max-w-2xl mb-10">
          Pair your session with the visuals and rollout to match — music
          videos, shorts, photo, and marketing, à la carte or bundled into a
          studio package.{' '}
          <span className="text-accent">
            {user
              ? 'Pricing and booking live in the Media Hub.'
              : 'Sign in to see pricing and book.'}
          </span>
        </p>

        {/* Packages first (the bigger-ticket bundles), then à la carte. */}
        {packages.length > 0 && (
          <div className="mb-10">
            <p className="font-mono text-[10px] sm:text-xs font-semibold tracking-[0.3em] uppercase text-white/40 mb-4">
              Studio Packages
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5">
              {packages.map((pkg) => (
                <MediaShowcaseCard
                  key={pkg.id}
                  title={pkg.title}
                  blurb={pkg.public_blurb}
                  items={slotsForOffering(pkg.components)}
                  variant="dark"
                />
              ))}
            </div>
          </div>
        )}

        {services.length > 0 && (
          <div>
            <p className="font-mono text-[10px] sm:text-xs font-semibold tracking-[0.3em] uppercase text-white/40 mb-4">
              À La Carte
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {services.map((svc) => (
                <MediaShowcaseCard
                  key={svc.id}
                  title={svc.title}
                  blurb={svc.public_blurb}
                  items={slotsForOffering(svc.components)}
                  variant="dark"
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}

        {/* One overall CTA into the real media flow. Login-gated, same as the
            session booking above it. */}
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="font-mono text-sm text-white/70 max-w-xl">
            {user
              ? 'Configure a package, add à la carte media, and check out in the Media Hub. Studio time inside a package loads your prepaid balance.'
              : 'Pricing, the package configurator, and booking open up after sign-in — the same account you use to book sessions.'}
          </p>
          <Link
            href={ctaHref}
            className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center gap-2 shrink-0"
          >
            {ctaLabel}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
