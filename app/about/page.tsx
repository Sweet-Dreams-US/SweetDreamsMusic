import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { MapPin, Clock } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { STUDIO_IMAGES } from '@/lib/images';
import { requireHref } from '@/lib/site-settings-server';
import { getSiteContent } from '@/lib/site-content-server';
import { content } from '@/lib/site-content';
import { getBrand } from '@/lib/brand-server';
import MetaTrack from '@/components/analytics/MetaTrack';

// Reads the site's nav flags at request time so the page can 404 when disabled.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About Sweet Dreams Music — Fort Wayne Recording Studio',
  description: 'Learn about Sweet Dreams Music LLC, a professional recording studio in Fort Wayne, Indiana. Two acoustically treated studios, premium equipment, four engineers, and 24/7 availability.',
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: 'About Sweet Dreams Music — Fort Wayne Recording Studio',
    description: 'Professional recording studio in Fort Wayne, Indiana. Two studios, premium equipment, four engineers, open 24/7.',
    url: `${SITE_URL}/about`,
    type: 'website',
  },
};

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
          src={STUDIO_IMAGES.iszacStudioAWide}
          alt="Studio A"
          fill
          className="object-cover opacity-30"
          priority
          sizes="100vw"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            {content(c, 'about.hero.kicker')}
          </p>
          <h1 className="text-display-md mb-6">{content(c, 'about.hero.title')}</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            {content(c, 'about.hero.intro')}
          </p>
        </div>
      </section>

      {/* Studio Info - White */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 sm:gap-16">
            <div>
              <h2 className="text-heading-xl mb-6">{content(c, 'about.body.heading')}</h2>
              <div className="font-mono text-body-sm text-black/70 space-y-4">
                <p>
                  Our facility features two fully-equipped recording studios — Studio A and Studio B —
                  both designed for professional-quality sound capture. Whether you&apos;re recording vocals,
                  instruments, podcasts, or voiceovers, our rooms are ready.
                </p>
                <p>
                  Every session includes access to industry-standard equipment and a professional
                  recording engineer who will ensure your project sounds its absolute best.
                </p>
                <p>
                  Sweet Dreams Music is a division of <a href="https://sweetdreams.us" className="text-accent hover:underline">Sweet Dreams</a>, Fort Wayne&apos;s creative media company.
                  We bring the same attention to quality and detail to every recording session.
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="border-2 border-black overflow-hidden">
                <div className="relative aspect-[16/9]">
                  <Image src={STUDIO_IMAGES.jayIszacPrvrbStudioAWide} alt="Studio A" fill className="object-cover" sizes="(max-width: 1024px) 100vw, 50vw" />
                </div>
                <div className="p-6 sm:p-8">
                  <h3 className="text-heading-sm mb-2">STUDIO A</h3>
                  <p className="font-mono text-sm text-black/60">Our primary recording room. Acoustically treated with professional-grade isolation.</p>
                </div>
              </div>

              <div className="border-2 border-black overflow-hidden">
                <div className="relative aspect-[16/9]">
                  <Image src={STUDIO_IMAGES.studioBSideLowAngleWide} alt="Studio B" fill className="object-cover" sizes="(max-width: 1024px) 100vw, 50vw" />
                </div>
                <div className="p-6 sm:p-8">
                  <h3 className="text-heading-sm mb-2">STUDIO B</h3>
                  <p className="font-mono text-sm text-black/60">Versatile second studio. Perfect for simultaneous sessions or smaller projects.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Equipment - Black */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Industry Standard
          </p>
          <h2 className="text-heading-xl mb-12 sm:mb-16">OUR EQUIPMENT</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {[
              { src: STUDIO_IMAGES.akgGraphic, alt: 'AKG Microphone' },
              { src: STUDIO_IMAGES.manleyGraphic, alt: 'Manley' },
              { src: STUDIO_IMAGES.mojaveGraphic, alt: 'Mojave' },
              { src: STUDIO_IMAGES.adamSpeakersWide, alt: 'Adam Audio Monitors' },
            ].map((item) => (
              <div key={item.alt} className="relative aspect-square overflow-hidden border border-white/10">
                <Image src={item.src} alt={item.alt} fill className="object-cover" sizes="(max-width: 768px) 50vw, 25vw" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 sm:gap-6 mt-4 sm:mt-6">
            {[
              { src: STUDIO_IMAGES.akgCloseup, alt: 'AKG closeup' },
              { src: STUDIO_IMAGES.bockMicCloseup, alt: 'Bock Audio mic' },
              { src: STUDIO_IMAGES.bockMicWide, alt: 'Bock Audio setup' },
            ].map((item) => (
              <div key={item.alt} className="relative aspect-[4/3] overflow-hidden border border-white/10">
                <Image src={item.src} alt={item.alt} fill className="object-cover" sizes="33vw" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Location & Hours */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-heading-xl mb-12">LOCATION & HOURS</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <MapPin className="w-6 h-6 text-accent" />
                <h3 className="text-heading-sm">LOCATION</h3>
              </div>
              <div className="font-mono text-black/60 text-sm space-y-2">
                <p>{brand.address.city}, {brand.address.state}</p>
                <p className="text-accent text-xs mt-4">
                  Full address provided upon booking confirmation
                </p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-3 mb-4">
                <Clock className="w-6 h-6 text-accent" />
                <h3 className="text-heading-sm">HOURS</h3>
              </div>
              <div className="font-mono text-black/60 text-sm space-y-3">
                <div>
                  <p className="text-black font-semibold">Regular Hours</p>
                  <p>Monday - Sunday: 9:00 AM - 9:00 PM</p>
                </div>
                <div>
                  <p className="text-black font-semibold">After Hours <span className="text-accent text-xs">+$10/hr</span></p>
                  <p>Daily: 9:00 PM - 3:00 AM</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={STUDIO_IMAGES.jayBoothWide}
          alt=""
          fill
          className="object-cover opacity-20"
          sizes="100vw"
        />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-display-md mb-6">COME SEE THE SPACE</h2>
          <p className="font-mono text-white/70 text-body-md max-w-2xl mx-auto mb-10">
            Book a session and experience the studio for yourself.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/book"
              className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
            >
              BOOK A SESSION
            </Link>
            <Link
              href="/contact"
              className="border-2 border-white text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-white hover:text-black transition-colors no-underline inline-flex items-center justify-center"
            >
              CONTACT US
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
