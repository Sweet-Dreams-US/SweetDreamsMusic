import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { SITE_URL, BEAT_LICENSES } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';
import { getBrand } from '@/lib/brand-server';
import { cityState } from '@/lib/brand';
import BeatStoreClient from '@/components/beats/BeatStoreClient';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: 'Beat Store — Buy Beats Online | MP3 Leases, Trackouts & Exclusives',
    description: `Browse and buy beats from ${brand.name} producers in ${cityState(brand)}. Hip-hop, trap, R&B, and more. MP3 leases from $29.99, trackout leases, and exclusive rights available. Preview and license beats instantly.`,
    alternates: { canonical: `${SITE_URL}/beats` },
    openGraph: {
      title: `Beat Store — Buy Beats Online | ${brand.name}`,
      description: `Browse and license beats from ${brand.address.city} producers. MP3 leases, trackout leases, and exclusive rights. Hip-hop, trap, R&B, drill, and more genres available.`,
      url: `${SITE_URL}/beats`,
      type: 'website',
    },
  };
}

export default async function BeatsPage() {
  const brand = await getBrand();
  const supabase = await createClient();

  const { data: beats } = await supabase
    .from('beats')
    .select('id, title, producer, producer_id, genre, bpm, musical_key, tags, preview_url, cover_image_url, mp3_lease_price, trackout_lease_price, exclusive_price, has_exclusive, contains_samples, lease_count, status, created_at, profiles!producer_id(display_name, producer_name, public_profile_slug)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  return (
    <>
      {/* Hero */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Beat Store
          </p>
          <h1 className="text-display-md mb-6">FIND YOUR SOUND</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Professionally produced beats, curated by {brand.name}.
            Browse, preview, and buy — instant download delivery.
          </p>
        </div>
      </section>

      {/* Beat Grid */}
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Suspense fallback={<p className="font-mono text-sm text-black/40">Loading beats...</p>}>
            <BeatStoreClient initialBeats={(beats || []).map((b) => ({
              ...b,
              // Supabase returns joined relations as arrays; normalize to single object
              profiles: Array.isArray(b.profiles) ? b.profiles[0] || null : b.profiles,
            }))} />
          </Suspense>
        </div>
      </section>

      {/* License Types */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-heading-xl mb-12">LICENSE TYPES</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {Object.entries(BEAT_LICENSES).map(([key, license]) => (
              <div key={key} className="border border-white/10 p-6 sm:p-8 hover:border-accent/50 transition-colors">
                <h3 className="text-heading-sm mb-3">{license.name}</h3>
                <p className="font-mono text-white/80 text-xs mb-4">{license.description}</p>
                <div className="border-t border-white/10 pt-4">
                  <p className="font-mono text-xs text-accent uppercase tracking-wider">Delivery</p>
                  <p className="font-mono text-sm text-white/70">{license.deliveryFormat}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTAs */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h2 className="text-heading-lg mb-4">WANT CUSTOM PRODUCTION?</h2>
              <p className="font-mono text-black/70 text-body-sm mb-6">
                Book a session with one of our producers and get a beat made specifically for you.
              </p>
              <Link href="/book"
                className="bg-black text-white font-mono text-sm font-bold tracking-wider uppercase px-6 py-3 hover:bg-black/80 transition-colors no-underline inline-flex items-center justify-center">
                BOOK A SESSION
              </Link>
            </div>
            <div>
              <h2 className="text-heading-lg mb-4">ARE YOU A PRODUCER?</h2>
              <p className="font-mono text-black/70 text-body-sm mb-6">
                Sell your beats on {brand.name}. You keep 60% of every sale.
              </p>
              <Link href="/sell-beats"
                className="border-2 border-black text-black font-mono text-sm font-bold tracking-wider uppercase px-6 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center justify-center">
                APPLY TO SELL
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
