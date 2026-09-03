import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { MapPin, Video, Clapperboard, Rocket, ArrowRight } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { SWEET_SPOT_IMAGES } from '@/lib/images';
import { requireHref } from '@/lib/site-settings-server';
import { getSiteContent } from '@/lib/site-content-server';
import { content } from '@/lib/site-content';
import { getBrand } from '@/lib/brand-server';
import MetaTrack from '@/components/analytics/MetaTrack';

// Reads the site's nav flags at request time so the page can 404 when disabled.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About Us',
  description: 'Sweet Dreams Music is a music media company in Fort Wayne, Indiana. Music videos, the Sweet Spot live-band series, short-form content, photo, and release marketing for artists, bands, and musicians.',
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: 'About Sweet Dreams Music — Fort Wayne Music Media',
    description: 'Music videos, live sessions, content, and photo for artists and bands. A Sweet Dreams company, Fort Wayne, Indiana.',
    url: `${SITE_URL}/about`,
    type: 'website',
  },
};

const HOW_WE_WORK = [
  {
    icon: Rocket,
    title: 'Plan',
    blurb: 'Every project starts with the song and the release date. We scope the visuals, the content, and the rollout around both.',
  },
  {
    icon: Video,
    title: 'Shoot',
    blurb: 'Music videos, live sessions, photo — one crew, one look, shot with the edit already in mind.',
  },
  {
    icon: Clapperboard,
    title: 'Release',
    blurb: 'Finished video, shorts, and stills delivered together, with a feature on our channels when it fits the series.',
  },
] as const;

export default async function AboutPage() {
  await requireHref('/about'); // 404 when the About page is disabled
  const c = await getSiteContent();
  const brand = await getBrand();
  return (
    <>
      <MetaTrack event="ViewContent" params={{ content_name: 'About', content_category: 'marketing' }} />
      {/* Hero */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={SWEET_SPOT_IMAGES.drummer}
          alt="A Sweet Spot session"
          fill
          className="object-cover opacity-30"
          priority
          sizes="100vw"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            {content(c, 'about.hero.kicker')}
          </p>
          <h1 className="text-display-md mb-6">{content(c, 'about.hero.heading')}</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            {content(c, 'about.hero.lede')}
          </p>
        </div>
      </section>

      {/* Story - White */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 sm:gap-16">
            <div>
              <h2 className="text-heading-xl mb-6">{content(c, 'about.story.heading')}</h2>
              <div className="font-mono text-body-sm text-black/70 space-y-4">
                <p>
                  We started as a recording studio, and that history is why we make media the way we do:
                  the visuals serve the music, never the other way around. Today the whole company is
                  built around one job — helping artists, bands, and musicians release work that looks as
                  good as it sounds.
                </p>
                <p>
                  That means music videos and short-form content cut for the feed, photo and cover art for
                  every drop, the Sweet Spot live-band series on our YouTube, and the release planning that
                  ties it all together.
                </p>
                <p>
                  {brand.name} is a division of{' '}
                  <a href="https://sweetdreams.us" className="text-accent hover:underline">Sweet Dreams</a>,
                  Fort Wayne&apos;s creative media company. Same crew, same standard, pointed at music.
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="border-2 border-black overflow-hidden">
                <div className="relative aspect-[16/9]">
                  <Image src={SWEET_SPOT_IMAGES.wide} alt="The Sweet Spot — wide performance shot" fill className="object-cover" sizes="(max-width: 1024px) 100vw, 50vw" />
                </div>
                <div className="p-6 sm:p-8">
                  <h3 className="text-heading-sm mb-2">THE SWEET SPOT</h3>
                  <p className="font-mono text-sm text-black/60">Our live-band video series. Two songs, multicam, a proper mix, and a feature on the Sweet Dreams YouTube.</p>
                </div>
              </div>

              <div className="border-2 border-black overflow-hidden">
                <div className="relative aspect-[16/9]">
                  <Image src={SWEET_SPOT_IMAGES.vocalist} alt="On set — vocalist close-up" fill className="object-cover" sizes="(max-width: 1024px) 100vw, 50vw" />
                </div>
                <div className="p-6 sm:p-8">
                  <h3 className="text-heading-sm mb-2">ON SET</h3>
                  <p className="font-mono text-sm text-black/60">Music videos, shorts, and photo — shot on location or on our floor, edited with the release in mind.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How we work - Black */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            How We Work
          </p>
          <h2 className="text-heading-xl mb-12 sm:mb-16">PLAN. SHOOT. RELEASE.</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            {HOW_WE_WORK.map((step) => (
              <div key={step.title} className="border border-white/10 p-8 sm:p-10">
                <step.icon className="w-10 h-10 text-accent mb-6" strokeWidth={1.5} />
                <h3 className="text-heading-sm mb-4">{step.title}</h3>
                <p className="font-mono text-white/60 text-body-sm">{step.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Location */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <MapPin className="w-6 h-6 text-accent" />
                <h2 className="text-heading-xl">WHERE WE ARE</h2>
              </div>
              <div className="font-mono text-black/60 text-sm space-y-2">
                <p>{brand.address.city}, {brand.address.state}</p>
                <p>On location across the region, or on our floor for live sessions and photo.</p>
              </div>
            </div>
            <div className="border-2 border-black/10 p-8">
              <h3 className="text-heading-sm mb-3">LOOKING FOR STUDIO TIME?</h3>
              <p className="font-mono text-sm text-black/60 mb-4">
                We no longer offer recording sessions. Here&apos;s where we send our artists.
              </p>
              <Link href="/recording" className="font-mono text-sm font-bold uppercase tracking-wider text-accent hover:underline no-underline inline-flex items-center gap-1">
                Where to record now <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={SWEET_SPOT_IMAGES.finalFrame}
          alt=""
          fill
          className="object-cover opacity-20"
          sizes="100vw"
        />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-display-md mb-6">LET&apos;S MAKE SOMETHING</h2>
          <p className="font-mono text-white/70 text-body-md max-w-2xl mx-auto mb-10">
            Tell us about the song, the date, and the look you&apos;re after.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact"
              className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
            >
              START A PROJECT
            </Link>
            <Link
              href="/media"
              className="border-2 border-white text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-white hover:text-black transition-colors no-underline inline-flex items-center justify-center"
            >
              SEE OUR WORK
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
