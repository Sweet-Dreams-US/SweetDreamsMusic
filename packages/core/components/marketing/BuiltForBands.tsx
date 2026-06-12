import Image from 'next/image';
import Link from 'next/link';
import { Users, Video, ArrowRight } from 'lucide-react';
import { STUDIO_IMAGES } from '@/lib/images';

/**
 * BuiltForBands — homepage marketing section announcing Sweet Dreams' band capabilities
 * and The Sweet Spot showcase program.
 *
 * Placed between "OUR SERVICES" and "THE MICS" on the homepage so it:
 *  1. Breaks up two black sections with a bright yellow beat,
 *  2. Surfaces the band pivot before users land on mic showcases,
 *  3. Links directly to /bands (the Sweet Spot program landing page).
 */
export default function BuiltForBands() {
  return (
    <section className="relative bg-yellow-300 text-black py-20 sm:py-28 overflow-hidden border-y-4 border-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 sm:gap-16 items-center">
          {/* Left — copy */}
          <div>
            <p className="font-mono text-black text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
              New at Sweet Dreams
            </p>
            <h2 className="text-heading-xl mb-6">BUILT FOR BANDS</h2>
            <p className="font-mono text-black/80 text-body-md mb-6 max-w-xl">
              Full tracking room. Line-of-sight between the mix room and the booth. We record live bands
              like few studios in Fort Wayne can — and we&apos;re turning that into a showcase series.
            </p>
            <p className="font-mono text-black/80 text-body-md mb-8 max-w-xl">
              Introducing <strong className="font-bold">The Sweet Spot</strong> — our band showcase program.
              Think Tiny Desk, but Fort Wayne, and on our floor. Performance, multicam capture, live mix, and
              a release-ready recording of your set.
            </p>

            <div className="flex flex-wrap gap-4 mb-8 font-mono text-sm">
              <span className="flex items-center gap-2 bg-black text-yellow-300 px-4 py-2 font-bold uppercase tracking-wider">
                <Users className="w-4 h-4" /> Live band tracking
              </span>
              <span className="flex items-center gap-2 bg-black text-yellow-300 px-4 py-2 font-bold uppercase tracking-wider">
                <Video className="w-4 h-4" /> Multicam video
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
                href="/contact"
                className="border-2 border-black text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black hover:text-yellow-300 transition-colors no-underline inline-flex items-center justify-center"
              >
                Book your band
              </Link>
            </div>
          </div>

          {/* Right — image */}
          <div className="relative aspect-[4/3] border-4 border-black overflow-hidden shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <Image
              src={STUDIO_IMAGES.jayIszacPrvrbStudioAWide}
              alt="Full band tracking in Studio A"
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
