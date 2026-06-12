import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import ProducerApplicationForm from '@/components/beats/ProducerApplicationForm';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: 'Sell Your Beats — Producer Applications',
    description: `Sell your beats on ${brand.name}. We partner with producers to reach more artists. 60/40 revenue split, storefront management, marketing, and payment processing included.`,
    alternates: { canonical: `${SITE_URL}/sell-beats` },
    openGraph: {
      title: `Sell Your Beats on ${brand.name}`,
      description: `Apply to sell beats on ${brand.name}. 60/40 revenue split, full storefront, marketing, and payment processing. Reach more artists in ${brand.address.city} and beyond.`,
      url: `${SITE_URL}/sell-beats`,
      type: 'website',
    },
  };
}

export default function SellBeatsPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            For Producers
          </p>
          <h1 className="text-display-md mb-6">SELL YOUR BEATS</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Partner with Sweet Dreams Music to reach more artists. We handle
            the storefront, marketing, and payments — you focus on making heat.
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-heading-xl mb-12">HOW IT WORKS</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <div className="border-2 border-black p-8">
              <span className="text-display-sm text-accent">01</span>
              <h3 className="text-heading-sm mt-4 mb-3">APPLY</h3>
              <p className="font-mono text-black/60 text-sm">
                Fill out the application below with your info, portfolio, and a sample beat.
              </p>
            </div>
            <div className="border-2 border-black p-8">
              <span className="text-display-sm text-accent">02</span>
              <h3 className="text-heading-sm mt-4 mb-3">GET APPROVED</h3>
              <p className="font-mono text-black/60 text-sm">
                Our team reviews your application. If approved, we&apos;ll set up your
                producer profile and shared drive for beat submissions.
              </p>
            </div>
            <div className="border-2 border-black p-8">
              <span className="text-display-sm text-accent">03</span>
              <h3 className="text-heading-sm mt-4 mb-3">EARN</h3>
              <p className="font-mono text-black/60 text-sm">
                You keep 60% of every sale. We handle payments, licensing, and delivery.
                Track your earnings from your producer dashboard.
              </p>
            </div>
          </div>

          {/* Commission breakdown */}
          <div className="border-2 border-accent p-8 mb-16">
            <h3 className="text-heading-sm mb-4">COMMISSION SPLIT</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-display-sm text-accent">60%</p>
                <p className="font-mono text-xs text-black/60 uppercase tracking-wider">You keep</p>
              </div>
              <div>
                <p className="text-display-sm text-black/30">40%</p>
                <p className="font-mono text-xs text-black/60 uppercase tracking-wider">Platform fee</p>
              </div>
            </div>
            <p className="font-mono text-[10px] text-black/40 mt-4">
              Platform fee covers hosting, storefront, marketing, payment processing, licensing, and customer support.
            </p>
          </div>

          {/* Application Form */}
          <div>
            <h2 className="text-heading-xl mb-8">APPLY NOW</h2>
            <ProducerApplicationForm />
          </div>
        </div>
      </section>
    </>
  );
}
