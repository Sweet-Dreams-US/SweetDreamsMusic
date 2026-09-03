import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Video, Clapperboard, Camera, Megaphone, FolderOpen, MessageCircle, ExternalLink } from 'lucide-react';
import { SITE_URL, PARTNER_STUDIO } from '@/lib/constants';
import { SWEET_SPOT_IMAGES } from '@/lib/images';
import { getBrand } from '@/lib/brand-server';
import MetaTrack from '@/components/analytics/MetaTrack';

export const metadata: Metadata = {
  title: 'Recording Sessions Have Moved',
  description:
    'Sweet Dreams Music no longer offers recording sessions or studio bookings. We now focus entirely on music media — music videos, live sessions, short-form content, photo, and release marketing for artists and bands. Here is where to go for studio time.',
  alternates: { canonical: `${SITE_URL}/recording` },
  openGraph: {
    title: 'Recording Sessions Have Moved | Sweet Dreams Music',
    description:
      'Sweet Dreams Music is now media-only. Find out where to book studio time, and what we make now.',
    url: `${SITE_URL}/recording`,
    type: 'website',
  },
};

/**
 * /recording — the landing page for everyone who still arrives looking for
 * studio time. /book, /pricing and /engineers 308-redirect here (next.config).
 *
 * Three jobs, in order:
 *   1. Say plainly that recording + booking are gone (no dead-end 404).
 *   2. Hand them to the partner studio (PARTNER_STUDIO in lib/constants —
 *      an empty url degrades to "reach out and we'll point you there").
 *   3. Show what Sweet Dreams Music does now, and reassure past clients that
 *      their files + session history are still in the dashboard.
 */
export default async function RecordingMovedPage() {
  const brand = await getBrand();
  const partnerName = PARTNER_STUDIO.name.trim();
  const partnerUrl = PARTNER_STUDIO.url.trim();

  return (
    <>
      <MetaTrack event="ViewContent" params={{ content_name: 'Recording moved', content_category: 'marketing' }} />

      {/* Hero */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={SWEET_SPOT_IMAGES.performance}
          alt=""
          fill
          className="object-cover opacity-25"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/90" />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            A note from {brand.name}
          </p>
          <h1 className="text-display-md mb-6">RECORDING HAS MOVED.</h1>
          <p className="font-mono text-white/75 text-body-md max-w-2xl mb-4">
            {brand.name} no longer offers recording sessions or studio bookings. We&apos;ve refocused
            everything on <strong className="text-white">media for musicians</strong> — music videos, live
            sessions, short-form content, photo, and the rollout that gets it heard.
          </p>
          <p className="font-mono text-white/60 text-body-sm max-w-2xl">
            If you were coming to book studio time, here&apos;s where to go. If you want visuals for the
            music you&apos;ve already made, you&apos;re in exactly the right place.
          </p>
        </div>
      </section>

      {/* Partner studio */}
      <section className="bg-accent text-black py-16 sm:py-20 border-y-4 border-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-black/70 text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Need studio time?
          </p>
          <h2 className="text-heading-xl mb-6">
            {partnerName ? `WE RECOMMEND ${partnerName.toUpperCase()}` : 'WE’LL POINT YOU TO THE RIGHT ROOM'}
          </h2>
          <div className="max-w-3xl font-mono text-body-sm text-black/80 space-y-4 mb-8">
            {partnerName ? (
              <p>
                {PARTNER_STUDIO.blurb.trim() ||
                  `For recording, mixing, and mastering, we now send our artists to ${partnerName}. Tell them Sweet Dreams sent you.`}
              </p>
            ) : (
              <p>
                We&apos;re sending our artists to a studio we trust for recording, mixing, and mastering.
                Reach out and we&apos;ll connect you directly.
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            {partnerUrl ? (
              <a
                href={partnerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-black text-accent font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors no-underline inline-flex items-center justify-center gap-2"
              >
                Book at {partnerName} <ExternalLink className="w-4 h-4" />
              </a>
            ) : null}
            <Link
              href="/contact"
              className={`${partnerUrl ? 'border-2 border-black text-black hover:bg-black hover:text-accent' : 'bg-black text-accent hover:bg-black/80'} font-mono text-base font-bold tracking-wider uppercase px-8 py-4 transition-colors no-underline inline-flex items-center justify-center gap-2`}
            >
              <MessageCircle className="w-4 h-4" /> Ask us where to record
            </Link>
          </div>
        </div>
      </section>

      {/* What we do now */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">
            What we do now
          </p>
          <h2 className="text-heading-xl mb-10 sm:mb-12">MEDIA FOR MUSICIANS</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {[
              { icon: Video, title: 'Music Videos', blurb: 'Concept, shoot, edit — mid-tier to premium productions.' },
              { icon: Clapperboard, title: 'Live Sessions & Shorts', blurb: 'The Sweet Spot live-band series, plus reels and shorts cut for the feed.' },
              { icon: Camera, title: 'Photo & Cover Art', blurb: 'Press shots, promo photos, and artwork built for every drop.' },
              { icon: Megaphone, title: 'Release Marketing', blurb: 'Rollout plans and content calendars so the work actually lands.' },
            ].map((t) => (
              <div key={t.title} className="border-2 border-black/10 p-6 hover:border-accent transition-colors flex flex-col">
                <t.icon className="w-7 h-7 text-accent mb-4" strokeWidth={1.5} />
                <h3 className="text-heading-md mb-2">{t.title}</h3>
                <p className="font-mono text-sm text-black/65 leading-relaxed">{t.blurb}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href="/media"
              className="bg-black text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors no-underline inline-flex items-center justify-center gap-2"
            >
              See the media catalog <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/bands"
              className="border-2 border-black text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center justify-center"
            >
              The Sweet Spot for bands
            </Link>
          </div>
        </div>
      </section>

      {/* Existing clients */}
      <section className="bg-black text-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="border-2 border-white/15 p-8 sm:p-10 flex flex-col md:flex-row md:items-center gap-6">
            <FolderOpen className="w-10 h-10 text-accent shrink-0" strokeWidth={1.5} />
            <div className="flex-1">
              <h2 className="text-heading-md mb-2">RECORDED WITH US BEFORE?</h2>
              <p className="font-mono text-white/70 text-body-sm">
                Your session history and every file your engineer delivered are still in your dashboard.
                Sign in to download them any time.
              </p>
            </div>
            <Link
              href="/login?redirect=/dashboard/files"
              className="bg-accent text-black font-mono text-sm font-bold tracking-wider uppercase px-6 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center gap-2 shrink-0"
            >
              Open my files <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
