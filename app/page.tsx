import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Video, Clapperboard, Camera, Palette, Megaphone, Sparkles, ArrowRight, MessageCircle, Music } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { getSiteSettings } from '@/lib/site-settings-server';
import { getSiteContent } from '@/lib/site-content-server';
import { content } from '@/lib/site-content';
import { STUDIO_IMAGES, SWEET_SPOT_IMAGES } from '@/lib/images';
import { PORTFOLIO_VIDEOS } from '@/lib/portfolio';
import HeroTitle from '@/components/home/HeroTitle';
import BuiltForBands from '@/components/marketing/BuiltForBands';
import MetaTrack from '@/components/analytics/MetaTrack';

export const metadata: Metadata = {
  title: 'Sweet Dreams Music — Music Videos, Live Sessions & Content for Artists | Fort Wayne, IN',
  description: 'Music media for artists, bands, and musicians in Fort Wayne, Indiana. Music videos, the Sweet Spot live-band series, short-form content, photo sessions, cover art, and release marketing. Plus a beat store with MP3, trackout, and exclusive licenses.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Sweet Dreams Music — Music Media for Artists & Bands',
    description: 'Music videos, live sessions, short-form content, photo, and release marketing for artists, bands, and musicians. Fort Wayne, Indiana.',
    url: SITE_URL,
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'Sweet Dreams Music — Music Media for Artists & Bands',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sweet Dreams Music — Music Media for Artists & Bands',
    description: 'Music videos, live sessions, short-form content, photo, and release marketing for musicians. Fort Wayne, IN.',
    images: [`${SITE_URL}/og-image.png`],
  },
};

// The public service line-up. Mirrors the live media catalog (media_offerings)
// at the category level — prices never appear on public surfaces (Cole's rule),
// so these tiles sell the WHAT and hand off to /media for the how-much.
const SERVICES = [
  {
    icon: Video,
    title: 'Music Videos',
    description: 'Concept, shoot, and edit — from a mid-tier single visual to a premium multi-location production.',
    image: SWEET_SPOT_IMAGES.performance,
    href: '/media',
  },
  {
    icon: Clapperboard,
    title: 'Short-Form Content',
    description: 'Reels, TikToks, and Shorts cut for the feed. Basic to premium, built to keep a release moving.',
    image: SWEET_SPOT_IMAGES.vocalist,
    href: '/media',
  },
  {
    icon: Sparkles,
    title: 'The Sweet Spot',
    description: 'Our live-band video series. Two songs, multicam, a professional mix, and a feature on our YouTube.',
    image: SWEET_SPOT_IMAGES.wide,
    href: '/bands',
    bandsOnly: true,
  },
  {
    icon: Camera,
    title: 'Photo Sessions',
    description: 'Press shots, promo photos, and on-set stills so every drop has visuals to go with it.',
    image: STUDIO_IMAGES.doloWindowSquare,
    href: '/media',
  },
  {
    icon: Palette,
    title: 'Cover Art',
    description: 'Single and project artwork designed to read at thumbnail size and hold up on a wall.',
    image: STUDIO_IMAGES.jayStudioBWritingWide,
    href: '/media',
  },
  {
    icon: Megaphone,
    title: 'Release Marketing',
    description: 'Rollout planning, content calendars, and campaign strategy — hourly or in 4-hour blocks.',
    image: STUDIO_IMAGES.adamCloseupWide,
    href: '/media',
  },
] as const;

const STEPS = [
  {
    n: '01',
    title: 'Tell us the vision',
    blurb: 'Send the song, the references, and the release date. We reply within a business day and scope it with you.',
  },
  {
    n: '02',
    title: 'We plan, shoot, and edit',
    blurb: 'Locations, crew, and a shot list built around the track. You approve the cut; we handle the rest.',
  },
  {
    n: '03',
    title: 'You release, we push it',
    blurb: 'Finished video, shorts, and stills delivered together — with a feature on our channels when it fits.',
  },
] as const;

export default async function HomePage() {
  // Hide the Sweet Spot tile + section when Bands is turned off (its CTA would 404).
  const flags = await getSiteSettings();
  const c = await getSiteContent();
  const services = SERVICES.filter((s) => !('bandsOnly' in s && s.bandsOnly) || flags.bandsEnabled);

  return (
    <>
      <MetaTrack event="ViewContent" params={{ content_name: 'Home', content_category: 'marketing' }} />
      {/* Hero */}
      <section className="relative bg-black text-white min-h-[90vh] flex items-center justify-center overflow-hidden">
        <Image
          src={content(c, 'home.hero.background')}
          alt="Sweet Dreams Music — on set"
          fill
          className="object-cover opacity-40"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black" />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center py-20">
          <p className="font-mono text-accent text-sm sm:text-base font-semibold tracking-[0.3em] uppercase mb-6">
            {content(c, 'home.hero.eyebrow')}
          </p>
          <HeroTitle />
          <p className="font-mono text-white/70 text-body-md max-w-2xl mx-auto mb-10">
            Music videos, live sessions, short-form content, photo, and release marketing —
            made for artists, bands, and musicians.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/media"
              className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center">
              SEE OUR WORK
            </Link>
            <Link href="/contact"
              className="border-2 border-white text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-white hover:text-black transition-colors no-underline inline-flex items-center justify-center">
              START A PROJECT
            </Link>
          </div>
        </div>
      </section>

      {/* Services - Black */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">What We Make</p>
          <h2 className="text-heading-xl mb-12 sm:mb-16">MEDIA FOR MUSICIANS</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-12">
            {services.map((service) => (
              <Link
                key={service.title}
                href={service.href}
                className="border border-white/10 hover:border-accent/50 transition-colors overflow-hidden group no-underline text-white flex flex-col"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <Image
                    src={service.image}
                    alt={service.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                </div>
                <div className="p-8 sm:p-10 flex flex-col flex-grow">
                  <service.icon className="w-10 h-10 text-accent mb-6" strokeWidth={1.5} />
                  <h3 className="text-heading-sm mb-4">{service.title}</h3>
                  <p className="font-mono text-white/60 text-body-sm flex-grow">{service.description}</p>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1 text-accent mt-6 group-hover:gap-2 transition-all">
                    Learn more <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* The Sweet Spot — yellow break between Services and Selected Work */}
      {flags.bandsEnabled && <BuiltForBands />}

      {/* Selected Work - White */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-sm font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">Selected Work</p>
          <h2 className="text-heading-xl mb-12 sm:mb-16">WHAT WE&apos;VE MADE</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {PORTFOLIO_VIDEOS.slice(0, 4).map((video) => (
              <div
                key={video.id}
                className="w-full border-2 border-black"
                style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', background: '#000' }}
              >
                <iframe
                  src={`https://www.youtube.com/embed/${video.id}`}
                  title={video.title}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link href="/media"
              className="border-2 border-black text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center justify-center gap-2">
              See more work <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* How it works - Black */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">How It Works</p>
          <h2 className="text-heading-xl mb-12 sm:mb-16">FROM SONG TO SCREEN</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            {STEPS.map((step) => (
              <div key={step.n} className="border border-white/10 p-8 sm:p-10">
                <p className="font-heading text-display-sm text-accent mb-4">{step.n}</p>
                <h3 className="text-heading-sm mb-4">{step.title}</h3>
                <p className="font-mono text-white/60 text-body-sm">{step.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Beat store strip - White */}
      <section className="bg-white text-black py-12 sm:py-16 border-t-2 border-black/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <Music className="w-8 h-8 text-accent shrink-0" strokeWidth={1.5} />
            <div>
              <h2 className="text-heading-md mb-1">NEED A BEAT FIRST?</h2>
              <p className="font-mono text-sm text-black/60">
                The Sweet Dreams Beat Store — MP3 leases, trackouts, and exclusives from our producers.
              </p>
            </div>
          </div>
          <Link href="/beats"
            className="border-2 border-black text-black font-mono text-sm font-bold tracking-wider uppercase px-6 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center justify-center gap-2 shrink-0">
            Browse beats <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={SWEET_SPOT_IMAGES.liveMoment}
          alt=""
          fill
          className="object-cover opacity-20"
          sizes="100vw"
        />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-display-md mb-6">READY TO RELEASE?</h2>
          <p className="font-mono text-white/70 text-body-md max-w-2xl mx-auto mb-10">
            Tell us about the song and the date. We&apos;ll come back with a plan for the visuals,
            the content, and the rollout.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/contact"
              className="bg-accent text-black font-mono text-lg font-bold tracking-wider uppercase px-10 py-5 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center gap-2">
              <MessageCircle className="w-5 h-5" /> Start a project
            </Link>
            <Link href="/media"
              className="border-2 border-white text-white font-mono text-lg font-bold tracking-wider uppercase px-10 py-5 hover:bg-white hover:text-black transition-colors no-underline inline-flex items-center justify-center">
              Browse the catalog
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
