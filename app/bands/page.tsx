import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  Video,
  Music,
  ArrowRight,
  Camera,
  Film,
  Sparkles,
  Users,
  Mic2,
  Calendar,
  MessageCircle,
} from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { requireHref } from '@/lib/site-settings-server';
import MetaTrack from '@/components/analytics/MetaTrack';

export const metadata: Metadata = {
  title: 'The Sweet Spot — Live Band Video Series',
  description:
    'The Sweet Spot is our premium live-band video series — full video, two songs in a professional mix, 3-6 short-form clips, featured on the Sweet Dreams YouTube. Plus music videos, shorts, and photo for bands. Fort Wayne, Indiana.',
  alternates: { canonical: `${SITE_URL}/bands` },
  openGraph: {
    title: 'The Sweet Spot — Live Band Video Series — Sweet Dreams Music',
    description:
      'Premium live-band video series in Fort Wayne. Multicam video, a professional two-song mix, short-form clips, featured on our YouTube.',
    url: `${SITE_URL}/bands`,
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'The Sweet Spot — Sweet Dreams Music Band Showcase',
      },
    ],
  },
};

// Sweet Spot assets hosted in Supabase Storage. Domain is allowlisted in
// next.config.ts so <Image> works without extra setup.
const SWEET_SPOT_BASE =
  'https://fweeyjnqwxywmpmnqpts.supabase.co/storage/v1/object/public/SweetSpot';
const SWEET_SPOT_LOGO = `${SWEET_SPOT_BASE}/sweetspotLogo.png`;
const SWEET_SPOT_PHOTOS = [
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_00_26_07.jpg`, alt: 'Sweet Spot session — full band in frame' },
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_01_47_18.jpg`, alt: 'Sweet Spot session — vocalist close-up' },
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_02_47_11.jpg`, alt: 'Sweet Spot session — instrument detail' },
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_03_05_09.jpg`, alt: 'Sweet Spot session — wide performance shot' },
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_03_54_18.jpg`, alt: 'Sweet Spot session — drummer in focus' },
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_07_24_17.jpg`, alt: 'Sweet Spot session — performance angle' },
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_07_50_14.jpg`, alt: 'Sweet Spot session — live moment' },
  { src: `${SWEET_SPOT_BASE}/Timeline 1_01_08_42_14.jpg`, alt: 'Sweet Spot session — final frame' },
] as const;

// What you actually get with a Sweet Spot booking. This is the whole pitch —
// straight, no "apply / review / maybe" language, because this is pay-to-book.
const SWEET_SPOT_INCLUDES = [
  {
    icon: Film,
    title: 'Full Video',
    description:
      'A full-length video of your Sweet Spot session, multicam, color-graded, ready for YouTube, press, label pitches, and your release rollout.',
  },
  {
    icon: Mic2,
    title: 'Two Songs, Professional Mix',
    description:
      'Two songs recorded live in our tracking room, mixed by our team. Delivered as finished masters you can release or use for sync.',
  },
  {
    icon: Sparkles,
    title: '3–6 Short-Form Clips',
    description:
      'Vertical cuts built for Reels, TikTok, and Shorts — formatted to push the video (and your band) on social.',
  },
  {
    icon: Video,
    title: 'Featured on Sweet Dreams YouTube',
    description:
      'Your Sweet Spot lands on our YouTube channel with full credit links, so our audience finds you alongside everything else we publish.',
  },
] as const;

// Quick pitch tiles for the "What bands do here" section. Sweet Spot is one of
// four — music videos, filming, Sweet Spot, hub — instead of dominating the page.
const BAND_FEATURES = [
  {
    icon: Video,
    title: 'Music Videos',
    blurb: 'Full-production music videos for your band — concept, shoot, edit, release. Mid-tier to premium.',
    href: '/media',
    cta: 'See media catalog',
  },
  {
    icon: Camera,
    title: 'Band Filming',
    blurb: 'Music videos, on-floor multicam, performance shoots. Film and record at the same studio.',
    href: '/media',
    cta: 'See media catalog',
  },
  {
    icon: Sparkles,
    title: 'The Sweet Spot',
    blurb: 'Our flagship live-band video showcase. Two songs, full mix, short-form clips, featured on our YouTube.',
    href: '#sweet-spot',
    cta: 'About the Sweet Spot',
  },
  {
    icon: Users,
    title: 'Band Hub',
    blurb: 'Collab on bookings, manage members, share files. Every band on the platform gets one.',
    href: '/dashboard/bands',
    cta: 'Open band hub',
  },
] as const;

export default async function BandsPage() {
  await requireHref('/bands'); // 404 when Bands is disabled in the control panel
  return (
    <>
      <MetaTrack event="ViewContent" params={{ content_name: 'Bands', content_category: 'marketing' }} />
      {/* ═══════════════════════════════════════════════════════════════
          HERO — slim. Heavy paragraphs were dropped per Cole's feedback;
          the page no longer leads with Sweet Spot copy. The four-feature
          tile section right below carries the explanation work.
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={SWEET_SPOT_PHOTOS[0].src}
          alt="Sweet Dreams band sessions"
          fill
          className="object-cover opacity-25"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/85" />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Bands at Sweet Dreams Music
          </p>
          <h1 className="text-display-md sm:text-display-lg mb-8">PLAY. FILM. RELEASE.</h1>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/bands/sweet-spot/inquire"
              className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              Inquire about the Sweet Spot
            </Link>
            <Link
              href="#sweet-spot"
              className="border-2 border-white text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-white hover:text-black transition-colors no-underline inline-flex items-center justify-center gap-2"
            >
              <Video className="w-4 h-4" />
              What the Sweet Spot is
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          WHAT BANDS DO HERE — four-feature tile grid, broader than the old
          Sweet-Spot-only pitch. Each tile links into the relevant deeper
          section or another page; Sweet Spot is one tile among four.
          ═══════════════════════════════════════════════════════════════ */}
      <section className="bg-white text-black py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">
            What bands do here
          </p>
          <h2 className="text-heading-xl mb-10 sm:mb-12">EVERYTHING UNDER ONE ROOF</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {BAND_FEATURES.map((f) => (
              <Link
                key={f.title}
                href={f.href}
                className="group border-2 border-black/10 p-6 hover:border-accent transition-colors no-underline text-black flex flex-col"
              >
                <f.icon className="w-7 h-7 text-accent mb-4" strokeWidth={1.5} />
                <h3 className="text-heading-md mb-2">{f.title}</h3>
                <p className="font-mono text-sm text-black/65 leading-relaxed mb-4 flex-grow">
                  {f.blurb}
                </p>
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1 text-accent group-hover:gap-2 transition-all mt-auto">
                  {f.cta} <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          WHAT THE SWEET SPOT IS — explain it properly. Deep-link target
          for the four-feature grid (#sweet-spot). Top accent border
          separates it from the broader band-features tile section above.
          ═══════════════════════════════════════════════════════════════ */}
      <section id="sweet-spot" className="bg-white text-black py-20 sm:py-28 border-t-4 border-accent scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 mb-4">
            <Image
              src={SWEET_SPOT_LOGO}
              alt="The Sweet Spot"
              width={64}
              height={64}
              className="w-12 h-12 sm:w-14 sm:h-14 object-contain"
            />
            <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase text-black/50">
              Sweet Dreams Music — Live Band Video Series
            </p>
          </div>
          <h2 className="text-heading-xl mb-8">A RELEASE-READY VIDEO SESSION</h2>
          <div className="max-w-3xl mb-12 sm:mb-16">
            <p className="font-mono text-black/80 text-body-md mb-4">
              The Sweet Spot is the Sweet Dreams Music <strong>live-band video series</strong>. You come in,
              play two songs live on our tracking floor, and leave with finished video, finished audio, and
              clips built to push the session on social.
            </p>
            <p className="font-mono text-black/70 text-body-sm">
              The Sweet Spot is the full package: multicam video, a professional mix of two songs,
              short-form content, and a feature on our YouTube.
              It&apos;s made to be released the day it&apos;s posted.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            {SWEET_SPOT_INCLUDES.map((item) => (
              <div
                key={item.title}
                className="border-2 border-black/10 p-8 sm:p-10 hover:border-accent transition-colors"
              >
                <item.icon className="w-10 h-10 text-accent mb-6" strokeWidth={1.5} />
                <h3 className="text-heading-sm mb-4">{item.title}</h3>
                <p className="font-mono text-black/70 text-body-sm">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FIRST SWEET SPOT — embedded YouTube. 56.25% padding-bottom gives
          a responsive 16:9 frame; accent border ties it to the dark
          section. Photo gallery was removed once the video shipped — the
          stills were a placeholder for the video drop.
          ═══════════════════════════════════════════════════════════════ */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            First Release
          </p>
          <h2 className="text-heading-xl mb-4">WATCH THE FIRST SWEET SPOT</h2>
          <p className="font-mono text-white/60 text-body-sm max-w-2xl mb-12 sm:mb-16">
            Press play for the first Sweet Spot drop — full video, multicam, mixed live on the
            tracking floor.
          </p>

          <div
            className="border-2 border-white/10 bg-black"
            style={{
              position: 'relative',
              paddingBottom: '56.25%',
              height: 0,
              overflow: 'hidden',
            }}
          >
            <iframe
              src="https://www.youtube.com/embed/hvfjYGGmcMQ"
              title="The Sweet Spot — Sweet Dreams Music live-band video session"
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
          <p className="font-mono text-white/50 text-body-sm mt-4">
            Follow Sweet Dreams Music on YouTube to catch every Sweet Spot release as it drops.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          HOW IT WORKS — the real flow (pay-to-book, not submit-and-wait)
          ═══════════════════════════════════════════════════════════════ */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">
            How It Works
          </p>
          <h2 className="text-heading-xl mb-12 sm:mb-16">TWO WAYS TO BOOK</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12">
            {/* Path A: existing band on the platform */}
            <div className="border-2 border-black p-8 sm:p-10">
              <div className="flex items-center gap-3 mb-6">
                <Users className="w-8 h-8 text-accent" strokeWidth={1.5} />
                <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase text-black/60">
                  Path A · Already on Sweet Dreams
                </p>
              </div>
              <h3 className="text-heading-md mb-4">Book it directly</h3>
              <p className="font-mono text-black/70 text-body-sm mb-4">
                If your band is set up on Sweet Dreams Music, book the Sweet Spot straight from your
                Media Hub. We reserve <strong>4 hours for filming</strong> plus{' '}
                <strong>2 hours for setup</strong> (same day or day prior) and schedule both with you.
              </p>
              <ul className="font-mono text-black/60 text-body-sm space-y-2 mb-6">
                <li>· 4 hours filming + 2 hours setup, scheduled around the band</li>
                <li>· Stripe deposit holds your dates, remainder by cash, check, or transfer</li>
                <li>· Flat-rate pricing visible inside your Media Hub once signed in</li>
              </ul>
              <Link
                href="/dashboard/media"
                className="font-mono text-sm font-bold uppercase tracking-wider text-accent hover:underline no-underline inline-flex items-center gap-1"
              >
                Open your Media Hub <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Path B: brand-new band wants to learn more */}
            <div className="bg-black text-white border-2 border-black p-8 sm:p-10">
              <div className="flex items-center gap-3 mb-6">
                <Calendar className="w-8 h-8 text-accent" strokeWidth={1.5} />
                <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase text-white/60">
                  Path B · New to Us
                </p>
              </div>
              <h3 className="text-heading-md mb-4">Set up a 30-min call</h3>
              <p className="font-mono text-white/70 text-body-sm mb-4">
                New bands, or bands who want to walk through it before booking — send us a note with your
                phone and a good time window. We&apos;ll call you to cover what you&apos;ll play, how the
                session runs, and what delivery looks like.
              </p>
              <ul className="font-mono text-white/60 text-body-sm space-y-2 mb-6">
                <li>· 30 minutes, zero commitment</li>
                <li>· We reply within 1 business day</li>
                <li>· We&apos;ll book the session from there if it&apos;s a fit</li>
              </ul>
              <Link
                href="/bands/sweet-spot/inquire"
                className="font-mono text-sm font-bold uppercase tracking-wider text-accent hover:underline no-underline inline-flex items-center gap-1"
              >
                Start an inquiry <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FINAL CTA — yellow
          ═══════════════════════════════════════════════════════════════ */}
      <section className="bg-yellow-300 text-black py-20 sm:py-28 border-y-4 border-black">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Camera className="w-12 h-12 text-black mx-auto mb-6" strokeWidth={1.5} />
          <h2 className="text-display-sm mb-6">YOUR BAND. OUR FLOOR. ON VIDEO.</h2>
          <p className="font-mono text-black/80 text-body-md max-w-2xl mx-auto mb-10">
            The Sweet Spot is a flat-rate, release-ready video session. Two songs, full video, professional
            mix, short-form clips, featured on our YouTube. Book it if you&apos;re ready, or reach out to
            walk through it first.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/bands/sweet-spot/inquire"
              className="bg-black text-yellow-300 font-mono text-lg font-bold tracking-wider uppercase px-10 py-5 hover:bg-black/80 transition-colors no-underline inline-flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-5 h-5" />
              Inquire now
            </Link>
            <Link
              href="/dashboard/bands"
              className="border-2 border-black text-black font-mono text-lg font-bold tracking-wider uppercase px-10 py-5 hover:bg-black hover:text-yellow-300 transition-colors no-underline inline-flex items-center justify-center gap-2"
            >
              <Music className="w-5 h-5" />
              Go to band hub
            </Link>
          </div>
          {/* Cross-link to media catalog — Phase B scope item. Bands shopping
              for the Sweet Spot often want to compare it against music-video
              packages, photo work, and standalone shoots. Placing this under
              the primary CTAs keeps the inquire path dominant while still
              surfacing the broader catalog for browsers. */}
          <p className="font-mono text-xs text-black/60 mt-6">
            Looking for music videos, photos, or shorts for your band?{' '}
            <Link href="/media" className="underline hover:text-black font-bold">
              Browse the full media catalog →
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
