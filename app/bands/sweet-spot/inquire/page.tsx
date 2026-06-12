import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Clock, Phone, Mail } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import SweetSpotInquiryForm from '@/components/bands/SweetSpotInquiryForm';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: `Inquire About the Sweet Spot — ${brand.name}`,
    description:
      'Set up a 30-minute call to learn how the Sweet Spot works. Send your name, band, phone, and a good time — Jay and Cole will reach out.',
    alternates: { canonical: `${SITE_URL}/bands/sweet-spot/inquire` },
    robots: { index: true, follow: true },
  };
}

const SWEET_SPOT_LOGO =
  'https://fweeyjnqwxywmpmnqpts.supabase.co/storage/v1/object/public/SweetSpot/sweetspotLogo.png';

/**
 * Sweet Spot inquiry landing page. Pure server component — the form itself is
 * a client component for Turnstile + fetch. This page provides context (what
 * the call covers, expectations, contact fallback) so the form isn't floating
 * in a vacuum.
 */
export default function SweetSpotInquirePage() {
  return (
    <>
      {/* Header */}
      <section className="bg-black text-white py-12 sm:py-16 border-b-4 border-accent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/bands"
            className="font-mono text-xs text-white/60 hover:text-white no-underline inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to The Sweet Spot
          </Link>

          <div className="flex items-center gap-4 mb-6">
            <Image
              src={SWEET_SPOT_LOGO}
              alt="The Sweet Spot"
              width={64}
              height={64}
              className="w-12 h-12 sm:w-16 sm:h-16 object-contain"
            />
            <p className="font-mono text-accent text-xs font-semibold tracking-[0.3em] uppercase">
              Sweet Spot Inquiry
            </p>
          </div>

          <h1 className="text-display-sm mb-4">SET UP A 30-MIN CALL</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Tell us how to reach you and when&apos;s good. Jay and Cole will call to walk you through how the
            Sweet Spot works, answer questions, and book the session if it&apos;s a fit.
          </p>
        </div>
      </section>

      {/* What the call covers */}
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase mb-4 text-black/50">
            What we&apos;ll cover on the call
          </p>
          <ul className="font-mono text-black/80 text-body-sm space-y-3 mb-8">
            <li className="flex gap-3">
              <span className="text-accent font-bold flex-shrink-0">01</span>
              <span>
                <strong>What you&apos;ll play.</strong> Two songs, live, in one session. We talk through
                arrangement, dynamics, and anything we should pre-stage.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent font-bold flex-shrink-0">02</span>
              <span>
                <strong>How the session runs.</strong> 2 hours of setup (same day or day before), then 4
                hours of filming. Full tracking room, multicam, engineering team.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent font-bold flex-shrink-0">03</span>
              <span>
                <strong>What you leave with.</strong> Finished video, two mixed songs, 3–6 short-form clips,
                and a feature on the Sweet Dreams YouTube channel.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent font-bold flex-shrink-0">04</span>
              <span>
                <strong>Booking logistics.</strong> Flat-rate pricing — we&apos;ll cover the number on the
                call. A Stripe deposit holds your dates; remainder is due by cash, check, or transfer
                before the shoot.
              </span>
            </li>
          </ul>

          <div className="bg-black/5 border-l-4 border-accent p-5 mb-4">
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-black/60 mb-2 inline-flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Reply time
            </p>
            <p className="font-mono text-black/80 text-body-sm">
              We respond within 1 business day. The call itself is 30 minutes — zero commitment, no pressure
              to book on the call.
            </p>
          </div>
        </div>
      </section>

      {/* The form */}
      <section className="bg-black text-white py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SweetSpotInquiryForm />

          {/* Fallback contact */}
          <div className="mt-12 pt-8 border-t border-white/10">
            <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase mb-4 text-white/50">
              Prefer to reach us directly?
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <a
                href="mailto:jayvalleo@sweetdreams.us"
                className="font-mono text-sm text-white hover:text-accent transition-colors no-underline inline-flex items-center gap-2"
              >
                <Mail className="w-4 h-4 text-accent" />
                jayvalleo@sweetdreams.us
              </a>
              <a
                href="mailto:cole@sweetdreams.us"
                className="font-mono text-sm text-white hover:text-accent transition-colors no-underline inline-flex items-center gap-2"
              >
                <Mail className="w-4 h-4 text-accent" />
                cole@sweetdreams.us
              </a>
            </div>
            <p className="font-mono text-xs text-white/50 mt-4 inline-flex items-center gap-2">
              <Phone className="w-3 h-3" />
              Already a Sweet Dreams band? You can also book the Sweet Spot straight from your band hub.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
