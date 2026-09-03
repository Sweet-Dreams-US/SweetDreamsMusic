import Image from 'next/image';
import Link from 'next/link';
import { Users, Video, ArrowRight } from 'lucide-react';
import { SWEET_SPOT_IMAGES } from '@/lib/images';

/**
 * BuiltForBands — homepage marketing section for The Sweet Spot, the Sweet
 * Dreams live-band video series.
 *
 * Placed between "MEDIA FOR MUSICIANS" and "SELECTED WORK" on the homepage so it:
 *  1. Breaks up two dark sections with a bright yellow beat,
 *  2. Gives bands a dedicated hook before the general portfolio,
 *  3. Links directly to /bands (the Sweet Spot program landing page).
 *
 * Rendered only when the Bands feature is on (the home page checks the flag).
 */
export default function BuiltForBands() {
  return (
    <section className="relative bg-yellow-300 text-black py-20 sm:py-28 overflow-hidden border-y-4 border-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 sm:gap-16 items-center">
          {/* Left — copy */}
          <div>
            <p className="font-mono text-black text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
              For Bands
            </p>
            <h2 className="text-heading-xl mb-6">THE SWEET SPOT</h2>
            <p className="font-mono text-black/80 text-body-md mb-6 max-w-xl">
              Our live-band video series. Think Tiny Desk, but Fort Wayne. You play two songs live;
              we film it multicam, mix it properly, and cut the clips that push it on social.
            </p>
            <p className="font-mono text-black/80 text-body-md mb-8 max-w-xl">
              Every Sweet Spot lands on the Sweet Dreams YouTube with full credit links, so our
              audience finds you alongside everything else we publish. Release-ready the day it drops.
            </p>

            <div className="flex flex-wrap gap-4 mb-8 font-mono text-sm">
              <span className="flex items-center gap-2 bg-black text-yellow-300 px-4 py-2 font-bold uppercase tracking-wider">
                <Video className="w-4 h-4" /> Multicam video
              </span>
              <span className="flex items-center gap-2 bg-black text-yellow-300 px-4 py-2 font-bold uppercase tracking-wider">
                <Users className="w-4 h-4" /> Built for full bands
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/bands"
                className="bg-black text-yellow-300 font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors no-underline inline-flex items-center justify-center gap-2"
              >
                Explore The Sweet Spot <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/bands/sweet-spot/inquire"
                className="border-2 border-black text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black hover:text-yellow-300 transition-colors no-underline inline-flex items-center justify-center"
              >
                Inquire for your band
              </Link>
            </div>
          </div>

          {/* Right — image */}
          <div className="relative aspect-[4/3] border-4 border-black overflow-hidden shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <Image
              src={SWEET_SPOT_IMAGES.fullBand}
              alt="A Sweet Spot session — full band in frame"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
