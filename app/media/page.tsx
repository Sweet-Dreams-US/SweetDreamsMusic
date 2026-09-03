import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Package as PackageIcon, Sparkles } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { SWEET_SPOT_IMAGES } from '@/lib/images';
import { PORTFOLIO_VIDEOS } from '@/lib/portfolio';
import { getActiveOfferings } from '@/lib/media-server';
import { requireHref } from '@/lib/site-settings-server';
import { groupOfferings, isOfferingVisibleTo } from '@/lib/media';
import { getSessionUser } from '@/lib/auth';
import { getUserBands } from '@/lib/bands-server';
import MediaShowcaseCard from '@/components/media/MediaShowcaseCard';
import InstagramFeedSection from '@/components/media/InstagramFeedSection';
import MetaTrack from '@/components/analytics/MetaTrack';

export const metadata: Metadata = {
  title: 'Media — Music Videos, Shorts, Photo & Marketing',
  description:
    'Music videos, shorts, photo sessions, cover art, and release marketing — bundled or à la carte. Sign in to see pricing and book.',
  alternates: { canonical: `${SITE_URL}/media` },
  openGraph: {
    title: 'Shoot, Rollout, Grow — Sweet Dreams Music',
    description:
      'Music videos, shorts, photo, cover art, marketing — bundled or à la carte.',
    url: `${SITE_URL}/media`,
    type: 'website',
  },
};

// Catalog rows can change at any time via admin edits, so we don't want stale
// "what we offer" tiles after a catalog edit. Cheap query, dynamic is fine.
export const dynamic = 'force-dynamic';

/**
 * Public Media Hub. Section order (top → bottom):
 *
 *   1. HERO            — leads with "RECORD, ROLLOUT, GROW" + CTAs.
 *                        No separate /media title or description (we're
 *                        already on the media page; the path tells the user
 *                        where they are).
 *   2. PACKAGES        — all four solo packages on one row (desktop + tablet),
 *                        2×2 on mobile. Cards expand on hover (desktop) /
 *                        viewport-center (mobile) to reveal what's included.
 *   3. À LA CARTE      — same expand-on-hover pattern, smaller cards.
 *   4. MORE THAN STUDIO — yellow brand pitch + final CTA.
 *   5. SHOWCASE        — music videos we've made (portfolio at the bottom,
 *                        2-up on tablet+desktop, 1-up on mobile).
 *
 * Hard rules per Cole:
 *   - Public surface never shows prices, regardless of auth state.
 *   - Solo + anonymous viewers don't see band offerings AT ALL.
 *   - Bundle savings live in package prices; prepaid hours flow into the
 *     studio_credits "gift card" balance (visible only inside the dashboard).
 */
export default async function MediaPage() {
  await requireHref('/media'); // 404 when Media is disabled in the control panel
  const user = await getSessionUser();
  const bandMemberships = user ? await getUserBands(user.id) : [];
  const viewer: 'anonymous' | 'solo' | 'band' = !user
    ? 'anonymous'
    : bandMemberships.length > 0
      ? 'band'
      : 'solo';

  const offerings = await getActiveOfferings();
  const visible = offerings.filter((o) => isOfferingVisibleTo(o, viewer));
  const { packages, services } = groupOfferings(visible);

  // Pull slot labels from each offering's `components` JSONB. Standalones
  // (no components) get an empty list — the card still renders, just without
  // the expanded panel. Server-side computation keeps the client component
  // dumb (no offering-shape leakage to the browser).
  const slotsForOffering = (
    components:
      | { slots?: { label?: string | null }[] }
      | null
      | undefined,
  ): string[] => {
    if (!components?.slots) return [];
    return components.slots
      .map((s) => (typeof s.label === 'string' ? s.label : ''))
      .filter((l): l is string => l.length > 0);
  };

  return (
    <>
      <MetaTrack
        event="ViewContent"
        params={{ content_name: 'Media packages', content_category: 'packages' }}
      />
      {/* ──────────────────── HERO ──────────────────── */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={SWEET_SPOT_IMAGES.performance}
          alt="Sweet Dreams Media"
          fill
          className="object-cover opacity-30"
          priority
          sizes="100vw"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Music Videos · Shorts · Photo · Marketing · Packages
          </p>
          <h1 className="text-display-md mb-8">SHOOT. ROLLOUT. GROW.</h1>

          <div className="flex flex-col sm:flex-row gap-4">
            {user ? (
              <Link
                href="/dashboard/media"
                className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center gap-2"
              >
                Open the Media Hub <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login?redirect=/dashboard/media"
                  className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center gap-2"
                >
                  Sign in for pricing <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/contact"
                  className="border-2 border-white text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-white hover:text-black transition-colors no-underline inline-flex items-center justify-center"
                >
                  Talk to us
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ──────────────── DEALS & SPECIALS (red banners) ──────────────── */}
      {/* Data-driven from admin-managed media_deals (Deals panel in the Media
          Catalog tab): the loader already priced the offerings, so any
          offering carrying `.deal` gets a red promo section here. Bookable
          only through the artist account's Media Hub — drives sign-ups. */}
      {offerings.filter((o) => o.deal).map((o) => (
        <section key={o.deal!.id} className="bg-red-600 text-white py-10 sm:py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-2 text-white/80">
                Limited-time special
              </p>
              <h2 className="text-heading-xl">
                {o.deal!.title.toUpperCase()} —{' '}
                <span className="text-yellow-300">${(o.deal!.deal_price_cents / 100).toFixed(0)}</span>
              </h2>
              <p className="font-mono text-sm text-white/85 mt-2 max-w-xl">
                {o.deal!.tagline || 'Only bookable through your artist account’s Media Hub — sign in, hit Media, and lock it in.'}
              </p>
            </div>
            <Link
              href={user ? `/dashboard/media/${o.slug}/configure` : `/login?redirect=/dashboard/media/${o.slug}/configure`}
              className="bg-white text-red-600 font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-yellow-300 hover:text-black transition-colors no-underline inline-flex items-center justify-center gap-2 shrink-0"
            >
              Book the special <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      ))}

      {/* ──────────────────── STUDIO PACKAGES ──────────────────── */}
      {packages.length > 0 && (
        <section className="bg-black text-white py-16 sm:py-24 border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-3">
              <PackageIcon className="w-5 h-5 text-accent" />
              <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase text-white/60">
                Packages
              </p>
            </div>
            <p className="font-mono text-body-sm text-white/70 max-w-2xl mb-10">
              The bigger the bundle, the more you save vs booking the same work à la carte.
              Every package is built around a release —
              <span className="text-accent">&nbsp;video, content, photo, and the rollout to match</span>.
            </p>

            {/* Grid: 2-col on mobile (so 4 packages = 2×2), 4-col on tablet+desktop */}
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
        </section>
      )}

      {/* ──────────────────── À LA CARTE ──────────────────── */}
      {services.length > 0 && (
        <section className="bg-white text-black py-16 sm:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-3">
              <Sparkles className="w-5 h-5 text-accent" />
              <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase text-black/50">
                À La Carte
              </p>
            </div>
            <p className="font-mono text-body-sm text-black/70 max-w-2xl mb-10">
              Anything in a package, individually. Pick exactly what you need.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {services.map((svc) => (
                <MediaShowcaseCard
                  key={svc.id}
                  title={svc.title}
                  blurb={svc.public_blurb}
                  items={slotsForOffering(svc.components)}
                  variant="light"
                  size="sm"
                />
              ))}
            </div>

            {/* Bottom-of-catalog CTA — single, prominent, drives the only
                action this page can take: go see prices in the dashboard. */}
            <div className="mt-12 pt-8 border-t border-black/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p className="font-mono text-sm text-black/70 max-w-xl">
                {user
                  ? 'Open the Media Hub for full pricing, the package configurator, and booking.'
                  : 'Pricing and the package configurator open up after sign-in. Booking is per-engineer and per-location, so the dashboard handles the calendar logic.'}
              </p>
              <Link
                href={user ? '/dashboard/media' : '/login?redirect=/dashboard/media'}
                className="bg-accent text-black font-mono text-sm font-bold tracking-wider uppercase px-6 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2 shrink-0"
              >
                {user ? 'Open Media Hub' : 'Sign in for pricing'}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ──────────────────── MORE THAN A STUDIO ──────────────────── */}
      {/* Yellow brand-pitch block — the agency-ladder hand-off to sweetdreams.us. */}
      <section className="bg-accent text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="font-mono text-black/70 text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
              A Sweet Dreams Company
            </p>
            <h2 className="text-heading-xl mb-6">MORE THAN A VIDEO CREW</h2>
            <div className="font-mono text-body-sm text-black/80 space-y-4 mb-10">
              <p>
                Sweet Dreams Music is the music arm of{' '}
                <a href="https://sweetdreams.us" className="underline font-bold hover:text-black">
                  Sweet Dreams
                </a>{' '}
                — Fort Wayne&apos;s creative media company. Music videos, live sessions, short-form
                content, photo, and release marketing for artists and bands; branding, web, and
                digital content for everyone else.
              </p>
              <p>
                Need a music video? A visual identity? A full release strategy? Sweet Dreams does
                it all under one roof.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="https://sweetdreams.us"
                className="bg-black text-accent font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors no-underline inline-flex items-center justify-center"
              >
                VISIT SWEETDREAMS.US
              </a>
              <Link
                href="/contact"
                className="border-2 border-black text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black hover:text-accent transition-colors no-underline inline-flex items-center justify-center"
              >
                GET IN TOUCH
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────────── SHOWCASE (bottom of page) ──────────────────── */}
      {/* Slim white strip before the footer — keeps the footer from butting
          straight against the yellow block while not adding a heavy section
          break. py-8 instead of the previous py-20. */}
      <section className="bg-white text-black py-8 sm:py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-sm font-semibold tracking-[0.3em] uppercase mb-2 text-black/50">
            Selected Work
          </p>
          <h2 className="text-heading-xl mb-8 sm:mb-10">MUSIC VIDEOS WE&apos;VE MADE</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {PORTFOLIO_VIDEOS.map((video) => (
              <div
                key={video.id}
                className="w-full"
                style={{
                  position: 'relative',
                  paddingBottom: '56.25%',
                  height: 0,
                  overflow: 'hidden',
                  background: '#000',
                }}
              >
                <iframe
                  src={`https://www.youtube.com/embed/${video.id}`}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── ON INSTAGRAM (Phase 5 — live IG feed) ──────────────── */}
      {/* Server-rendered from the IG API (15-min cache); renders nothing if the
          API is unavailable, so it can never break this page. */}
      <InstagramFeedSection />
    </>
  );
}
