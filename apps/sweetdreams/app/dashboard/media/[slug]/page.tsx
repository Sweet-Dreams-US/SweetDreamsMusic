// app/dashboard/media/[slug]/page.tsx
//
// Offering detail page — the buy surface. As of Phase C.2 there are three
// CTA modes:
//
//   • Configurable package      → "Configure & Buy" links to /configure wizard
//   • Fixed-price + non-config  → "Buy" button POSTs base price directly
//   • Inquire-priced / ranged   → "Send an inquiry" routes to /inquire form
//   • Band-only + solo viewer   → 404 (visibility filter)
//
// "Configurable" means the offering has any slot the buyer can change —
// either skippable or with severity options. See `isOfferingConfigurable`.
// Standalones (no `components`) and packages with all-fixed slots (Sweet
// Spot Band) take the direct buy path.

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Clock, Mail, Settings2, ArrowRight } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getUserBands } from '@/lib/bands-server';
import { getOfferingBySlug } from '@/lib/media-server';
import {
  formatOfferingPrice,
  isOfferingVisibleTo,
  viewerEligibilityFromBands,
} from '@/lib/media';
import { isOfferingConfigurable } from '@/lib/media-config';
import DashboardNav from '@/components/layout/DashboardNav';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const offering = await getOfferingBySlug(slug);
  if (!offering) return { title: 'Not found' };
  return {
    title: `${offering.title} — Sweet Dreams Media`,
    description: offering.public_blurb ?? offering.description ?? undefined,
  };
}

export default async function OfferingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) {
    // Diagnostic log for the "logged-in user gets bounced to /login" report —
    // if this fires while the user is signed in, it means the cookie didn't
    // round-trip on this request (most often: stale dev-server secret after
    // restart, or a partially-refreshed Supabase session). Helps narrow down
    // the issue without breaking flow.
    console.warn(`[dashboard/media/[slug]] no session user on slug=${slug} — redirecting to /login`);
    redirect(`/login?redirect=/dashboard/media/${slug}`);
  }

  const offering = await getOfferingBySlug(slug);
  if (!offering) notFound();

  const bandMemberships = await getUserBands(user.id);
  const viewer = viewerEligibilityFromBands({
    authenticated: true,
    bandCount: bandMemberships.length,
  });

  // Visibility check — solo viewer hitting a band offering should 404, not
  // see a "members only" tease. Cole's rule: hide entirely.
  if (!isOfferingVisibleTo(offering, viewer)) notFound();

  // Inquire-priced = no fixed price and no range. Sweet Spot Individual,
  // band-by-request packages.
  const isInquireOnly =
    offering.price_cents == null &&
    offering.price_range_low_cents == null &&
    offering.price_range_high_cents == null;

  // For a price range (Premium MV $1,500–$5,000), we can't auto-checkout
  // because the actual price is set during planning. Inquiry flow.
  const isPriceRange =
    offering.price_range_low_cents != null && offering.price_range_high_cents != null;

  // The "buy now" path — only available when there's a single fixed price.
  const isBuyable = !isInquireOnly && !isPriceRange && offering.price_cents != null;

  // "Configurable" overrides direct-buy: if the package has skippable or
  // severity-tiered slots we route through the wizard so the buyer can
  // adjust the price + scope. Sweet Spot Band has price_cents but no
  // configurable slots → still takes the direct buy path.
  const isConfigurable = isBuyable && isOfferingConfigurable(offering);

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      <section className="bg-black text-white py-10 sm:py-14">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard/media"
            className="font-mono text-xs text-white/60 hover:text-white no-underline inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Media Hub
          </Link>

          <p className="font-mono text-accent text-xs font-semibold tracking-[0.3em] uppercase mb-3">
            {offering.kind === 'package' ? 'Studio Package' : 'Standalone Service'}
          </p>
          <h1 className="text-display-sm sm:text-display-md mb-4">{offering.title}</h1>

          <p className="font-mono text-3xl sm:text-4xl font-bold text-accent mb-6">
            {formatOfferingPrice(offering)}
          </p>

          {offering.public_blurb && (
            <p className="font-mono text-body-md text-white/80 max-w-2xl mb-3">
              {offering.public_blurb}
            </p>
          )}
          {offering.description && offering.description !== offering.public_blurb && (
            <p className="font-mono text-body-sm text-white/70 max-w-2xl">
              {offering.description}
            </p>
          )}

          {offering.studio_hours_included > 0 && (
            <div className="mt-6 inline-flex items-center gap-2 bg-accent/10 border border-accent/30 px-4 py-3">
              <Clock className="w-4 h-4 text-accent" />
              <p className="font-mono text-sm font-semibold text-accent">
                Includes {offering.studio_hours_included} hours of studio time —
                added to your prepaid balance at purchase
              </p>
            </div>
          )}
        </div>
      </section>

      {/* What's included — only meaningful for packages */}
      {offering.kind === 'package' && offering.components?.slots && (
        <section className="bg-white text-black py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase mb-4 text-black/50">
              What&apos;s included
            </p>
            <h2 className="text-heading-lg mb-8">EVERYTHING IN THE PACKAGE</h2>

            <ul className="space-y-3">
              {offering.components.slots.map((slot) => (
                <li
                  key={slot.key}
                  className="flex items-start gap-3 border-b border-black/5 pb-3"
                >
                  <Check className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-mono text-sm font-semibold">{slot.label}</p>
                    {slot.kind === 'hours' && slot.value && (
                      <p className="font-mono text-xs text-black/60 mt-0.5">
                        {slot.value} hours included
                      </p>
                    )}
                    {slot.kind === 'unit' && slot.count && (
                      <p className="font-mono text-xs text-black/60 mt-0.5">
                        {slot.count} included
                      </p>
                    )}
                    {slot.kind === 'per_song' && slot.count_per && (
                      <p className="font-mono text-xs text-black/60 mt-0.5">
                        {slot.count_per} per song
                      </p>
                    )}
                    {slot.kind === 'flexible' && (
                      <p className="font-mono text-xs text-black/60 mt-0.5">
                        Open-ended — as much as the project needs
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Buy / configure / inquire CTA */}
      <section className="bg-black text-white py-12 sm:py-16 border-t border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {isConfigurable ? (
            <>
              <h2 className="text-heading-lg mb-3">BUILD YOUR PACKAGE</h2>
              <p className="font-mono text-body-sm text-white/70 max-w-2xl mb-6">
                This package has options. Walk through each piece, pick your
                production tier or drop items you don&apos;t need, and the price
                updates as you go. You only pay for what you keep. After you
                build it, we&apos;ll ask for project details before checkout.
                {offering.studio_hours_included > 0 && (
                  <>
                    {' '}Studio recording hours land in your prepaid balance the
                    moment payment clears — schedule whenever you&apos;re ready.
                  </>
                )}
              </p>
              <Link
                href={`/dashboard/media/${offering.slug}/configure`}
                className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
              >
                <Settings2 className="w-4 h-4" />
                Start configuring
                <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          ) : isBuyable ? (
            <>
              <h2 className="text-heading-lg mb-3">READY TO BOOK?</h2>
              <p className="font-mono text-body-sm text-white/70 max-w-2xl mb-6">
                We&apos;ll grab project details next, then send you to Stripe to complete payment.
                {offering.studio_hours_included > 0 && (
                  <>
                    {' '}Your prepaid balance loads with{' '}
                    <span className="text-accent font-semibold">
                      {offering.studio_hours_included} hours
                    </span>{' '}
                    of studio time the moment payment clears.{' '}
                  </>
                )}
                Production scheduling happens after purchase — we reach out within 1 business day.
              </p>
              <Link
                href={`/dashboard/media/${offering.slug}/details`}
                className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
              >
                Continue to project details
                <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-heading-lg mb-3">LET&apos;S TALK</h2>
              <p className="font-mono text-body-sm text-white/70 max-w-2xl mb-6">
                {isPriceRange
                  ? "This one's priced by scope — final cost depends on the storyboard, locations, and edit complexity. Send us the project brief and we'll come back with a quote and timeline."
                  : "This one's a custom build. Tell us about the project and we'll come back with a tailored proposal."}
              </p>
              <Link
                href={`/dashboard/media/${offering.slug}/inquire`}
                className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                Send an inquiry
              </Link>
            </>
          )}
        </div>
      </section>
    </>
  );
}
