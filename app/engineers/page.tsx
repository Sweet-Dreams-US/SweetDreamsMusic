import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SITE_URL } from '@/lib/constants';
import { STUDIO_IMAGES } from '@/lib/images';
import { requireHref } from '@/lib/site-settings-server';
import { getEngineers } from '@/lib/engineers-server';

// Reads the site's nav flags at request time so the page can 404 when disabled.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Our Engineers — Recording, Mixing & Production',
  description: 'Meet the Sweet Dreams Music engineering team in Fort Wayne, IN. Four professional sound engineers specializing in recording, mixing, mastering, and music production. 30+ years of combined experience.',
  alternates: { canonical: `${SITE_URL}/engineers` },
  openGraph: {
    title: 'Our Engineers — Recording, Mixing & Production | Sweet Dreams Music',
    description: 'Four professional sound engineers in Fort Wayne, Indiana. Specializing in recording, mixing, mastering, and full music production.',
    url: `${SITE_URL}/engineers`,
    type: 'website',
  },
};

const ENGINEER_PHOTOS: Record<string, string> = {
  'PRVRB': STUDIO_IMAGES.prvrbBoothGlowVert,
  'Iszac Griner': STUDIO_IMAGES.iszacVert,
  'Zion': STUDIO_IMAGES.zStudioBVert,
  'Jay Val Leo': STUDIO_IMAGES.jayTopStudioBVert,
};

export default async function EngineersPage() {
  await requireHref('/engineers'); // 404 when the Engineers page is disabled
  const engineers = await getEngineers();
  return (
    <>
      {/* Hero */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={STUDIO_IMAGES.jayIszacPrvrbStudioAWide}
          alt="Sweet Dreams engineers"
          fill
          className="object-cover opacity-30"
          priority
          sizes="100vw"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            The Team
          </p>
          <h1 className="text-display-md mb-6">OUR ENGINEERS</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Each engineer brings their own style and expertise. 30+ years of mixing experience combined.
            Choose the right fit for your project, or let us match you with the perfect engineer for your sound.
          </p>
        </div>
      </section>

      {/* Engineers Grid - White */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {engineers.map((engineer) => {
              const photo = engineer.photoUrl || ENGINEER_PHOTOS[engineer.name];
              return (
                <div
                  key={engineer.id}
                  className="border-2 border-black group hover:border-accent transition-colors"
                >
                  <div className="aspect-square bg-black/5 flex items-center justify-center relative overflow-hidden">
                    {photo ? (
                      <Image
                        src={photo}
                        alt={engineer.displayName}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      />
                    ) : (
                      <span className="font-heading text-[120px] text-black/10 group-hover:text-accent/20 transition-colors">
                        {engineer.displayName[0]}
                      </span>
                    )}
                  </div>

                  <div className="p-6 sm:p-8">
                    <h2 className="text-heading-lg mb-3">{engineer.displayName}</h2>
                    <div className="flex flex-wrap gap-2">
                      {engineer.specialties.map((specialty) => (
                        <span
                          key={specialty}
                          className="font-mono text-xs font-semibold tracking-wider uppercase px-3 py-1 border border-black/20 text-black/60"
                        >
                          {specialty}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={STUDIO_IMAGES.ayeGBoothWide}
          alt=""
          fill
          className="object-cover opacity-20"
          sizes="100vw"
        />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-display-md mb-6">WORK WITH US</h2>
          <p className="font-mono text-white/70 text-body-md max-w-2xl mx-auto mb-10">
            Choose your preferred engineer when booking, or let us assign the best fit for your session.
          </p>
          <Link
            href="/book"
            className="bg-accent text-black font-mono text-lg font-bold tracking-wider uppercase px-10 py-5 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
          >
            BOOK A SESSION
          </Link>
        </div>
      </section>
    </>
  );
}
