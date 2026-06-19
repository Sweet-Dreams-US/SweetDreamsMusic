import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Clock, AlertCircle, Check, Star, Users, Moon } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { formatCents } from '@/lib/utils';
import { createServiceClient } from '@/lib/supabase/server';
import { getStudioConfigs } from '@/lib/studio-config-server';
import { priceSessionFromConfig, type StudioConfig } from '@/lib/studio-config';
import { STUDIO_IMAGES } from '@/lib/images';

export const metadata: Metadata = {
  title: 'Studio Pricing — Recording Rates & Packages',
  description: 'Sweet Dreams Music recording studio pricing in Fort Wayne, IN. Studio A from $70/hr, Studio B from $50/hr. The Sweet 4 — 4-hour flat-rate discount, band recording packages, and 24-hour availability. 50% deposit booking.',
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    title: 'Studio Pricing — Recording Rates & Packages | Sweet Dreams Music',
    description: 'Recording studio rates starting at $50/hr. Studio A and Studio B pricing, The Sweet 4 discount, band recording packages. Open 24/7 in Fort Wayne, Indiana.',
    url: `${SITE_URL}/pricing`,
    type: 'website',
  },
};

const included = [
  'Professional recording engineer',
  'Acoustically treated studio room',
  'Industry-standard equipment',
  'Basic mixing assistance',
  'Digital file delivery',
  'Comfortable lounge area',
];

export default async function PricingPage() {
  // DB-driven pricing (studio_rooms) so this page always matches the booking
  // engine + what the customer is charged. Constants fallback baked into the loader.
  const studios = await getStudioConfigs(createServiceClient());
  const bySlug = new Map(studios.map((s) => [s.slug, s]));
  const cfgA = bySlug.get('studio_a') ?? studios[0];
  const cfgB = bySlug.get('studio_b') ?? studios[1] ?? studios[0];
  const bandCfg = bySlug.get('studio_a') ?? studios.find((s) => s.bandEnabled) ?? studios[0];
  const sweet4 = (c: StudioConfig) => c.tiers.find((t) => t.kind === 'sweet_4');
  const surcharge = (kind: 'late_night' | 'deep_night' | 'same_day') => cfgA.surcharges.find((s) => s.kind === kind)?.amountCents ?? 0;
  const bandTiers = bandCfg.tiers.filter((t) => t.kind.startsWith('band_')).sort((a, b) => a.hours - b.hours);
  // Worked "how surcharges stack" example — computed from config so the numbers
  // can never drift from the real rates (4hr Studio A, midnight start, same-day).
  const stackEx = priceSessionFromConfig(cfgA, { hours: 4, startHour: 0, sameDay: true, guests: 1 });
  const tierName = (t: string) => (t === 'deepNight' ? 'after hours' : t === 'lateNight' ? 'late night' : 'regular');
  const hourLabel = (h: number) => { const hr = Math.floor(h) % 24; const disp = hr % 12 === 0 ? 12 : hr % 12; return `${disp} ${hr < 12 ? 'AM' : 'PM'}`; };

  return (
    <>
      {/* Hero */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={STUDIO_IMAGES.adamSpeakersWide}
          alt=""
          fill
          className="object-cover opacity-20"
          priority
          sizes="100vw"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Transparent Pricing
          </p>
          <h1 className="text-display-md mb-6">OUR RATES</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Simple pricing. Open 24 hours. 50% deposit to book, remainder after your session.
          </p>
        </div>
      </section>

      {/* Studio Rates - White */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            {/* Studio A */}
            <div className="border-4 border-black p-8 sm:p-12">
              <h2 className="text-heading-lg mb-2">STUDIO A</h2>
              <p className="font-mono text-sm text-black/50 mb-6">Premium room — top-tier acoustics and equipment</p>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="font-heading text-display-md">{formatCents(cfgA.hourlyRateCents)}</span>
                <span className="font-mono text-lg text-black/50">/hour</span>
              </div>
              <p className="font-mono text-xs text-black/40 mb-6">Single hour: {formatCents(cfgA.singleHourRateCents)}</p>
              <hr className="my-6 border-black/10" />
              <h3 className="text-heading-sm mb-4">INCLUDED</h3>
              <div className="space-y-3">
                {included.map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-accent flex-shrink-0" />
                    <span className="font-mono text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Studio B */}
            <div className="border-2 border-black p-8 sm:p-12">
              <h2 className="text-heading-lg mb-2">STUDIO B</h2>
              <p className="font-mono text-sm text-black/50 mb-6">Versatile room — great for all session types</p>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="font-heading text-display-md">{formatCents(cfgB.hourlyRateCents)}</span>
                <span className="font-mono text-lg text-black/50">/hour</span>
              </div>
              <p className="font-mono text-xs text-black/40 mb-6">Single hour: {formatCents(cfgB.singleHourRateCents)}</p>
              <hr className="my-6 border-black/10" />
              <h3 className="text-heading-sm mb-4">INCLUDED</h3>
              <div className="space-y-3">
                {included.map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-accent flex-shrink-0" />
                    <span className="font-mono text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* The Sweet 4 + Surcharges */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="border-2 border-accent p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <Star className="w-6 h-6 text-accent" />
                <h3 className="text-heading-sm">THE SWEET 4</h3>
              </div>
              <div className="space-y-3 mb-3">
                <div>
                  <p className="font-heading text-display-sm text-accent">{formatCents(sweet4(cfgA)?.priceCents ?? 0)}</p>
                  <p className="font-mono text-xs text-black/50">{cfgA.displayName} — {sweet4(cfgA)?.hours} hours ({formatCents(sweet4(cfgA)?.perHourCents ?? 0)}/hr)</p>
                </div>
                <div>
                  <p className="font-heading text-display-sm text-accent">{formatCents(sweet4(cfgB)?.priceCents ?? 0)}</p>
                  <p className="font-mono text-xs text-black/50">{cfgB.displayName} — {sweet4(cfgB)?.hours} hours ({formatCents(sweet4(cfgB)?.perHourCents ?? 0)}/hr)</p>
                </div>
              </div>
              <p className="font-mono text-sm text-black/60">Best value. Book 4 hours at a discounted flat rate.</p>
            </div>

            <div className="border-2 border-amber-400 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <Moon className="w-6 h-6 text-amber-500" />
                <h3 className="text-heading-sm">LATE NIGHT</h3>
              </div>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="font-heading text-display-sm">+{formatCents(surcharge('late_night'))}</span>
                <span className="font-mono text-sm text-black/50">/hour</span>
              </div>
              <p className="font-mono text-sm text-black/60">10 PM – 2 AM. Per-hour surcharge applies to each hour in this window.</p>
            </div>

            <div className="border-2 border-red-400 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <Clock className="w-6 h-6 text-red-500" />
                <h3 className="text-heading-sm">AFTER HOURS</h3>
              </div>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="font-heading text-display-sm">+{formatCents(surcharge('deep_night'))}</span>
                <span className="font-mono text-sm text-black/50">/hour</span>
              </div>
              <p className="font-mono text-sm text-black/60">2 AM – 9 AM. Per-hour surcharge applies to each hour in this window.</p>
            </div>

            <div className="border-2 border-black p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-accent" />
                <h3 className="text-heading-sm">SAME-DAY</h3>
              </div>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="font-heading text-display-sm">+{formatCents(surcharge('same_day'))}</span>
                <span className="font-mono text-sm text-black/50">/hour</span>
              </div>
              <p className="font-mono text-sm text-black/60">Booking and recording on the same day. Applies to every hour.</p>
            </div>
          </div>

          {/* How surcharges stack */}
          <div className="mt-8 border border-black/10 p-6">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-3">How Surcharges Work</h3>
            <p className="font-mono text-sm text-black/60 mb-3">
              Surcharges are calculated <strong className="text-black">per hour</strong>. If your session spans multiple time zones, each hour gets its own surcharge.
              Surcharges stack — a same-day session starting at 1 AM would have both the late night/after hours surcharge AND the same-day surcharge.
            </p>
            <div className="font-mono text-xs text-black/40 space-y-1">
              <p>Example: {stackEx.hourBreakdown.length}hr session starting at midnight, same-day booking</p>
              {stackEx.hourBreakdown.map((hb, i) => (
                <p key={i}>
                  {hourLabel(hb.hour)}: {formatCents(hb.baseRate)} base
                  {hb.nightFee > 0 && ` + ${formatCents(hb.nightFee)} ${tierName(hb.tier)}`}
                  {hb.sameDayFee > 0 && ` + ${formatCents(hb.sameDayFee)} same-day`}
                  {' = '}<strong className="text-black">{formatCents(hb.hourTotal)}</strong>
                </p>
              ))}
              <p className="pt-1 text-black font-semibold">Total: {formatCents(stackEx.total)} — Deposit: {formatCents(stackEx.deposit)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Band Recording - Black */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-3">
            <Users className="w-6 h-6 text-accent" />
            <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase">Studio A Only</p>
          </div>
          <h2 className="text-heading-xl mb-12 sm:mb-16">BAND RECORDING</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {bandTiers.map((pkg) => (
              <div key={pkg.hours} className="border border-white/10 p-8">
                <h3 className="text-heading-sm mb-2">{pkg.label}</h3>
                <p className="font-mono text-xs text-white/70 mb-4">{pkg.note}</p>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="font-heading text-display-sm text-accent">{formatCents(pkg.priceCents)}</span>
                </div>
                <p className="font-mono text-sm text-white/80">{formatCents(pkg.perHourCents)}/hour</p>
              </div>
            ))}
          </div>
          <p className="font-mono text-xs text-white/60 mt-8">
            Band recording includes full use of Studio A. 4-hour minimum booking required.
          </p>
        </div>
      </section>

      {/* Example Sessions - White */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-heading-xl mb-12">EXAMPLE SESSIONS</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: '2 HOURS — STUDIO B (DAYTIME)', room: 'studio_b' as const, hours: 2, startHour: 14, sameDay: false },
              { title: 'THE SWEET 4 — STUDIO A', room: 'studio_a' as const, hours: 4, startHour: 12, sameDay: false },
              { title: '3 HOURS — STUDIO A (11 PM START)', room: 'studio_a' as const, hours: 3, startHour: 23, sameDay: false },
            ].map((ex) => {
              const p = priceSessionFromConfig(bySlug.get(ex.room) ?? cfgA, { hours: ex.hours, startHour: ex.startHour, sameDay: ex.sameDay, guests: 1 });
              return (
                <div key={ex.title} className="border-2 border-black p-8">
                  <h3 className="text-heading-sm mb-4">{ex.title}</h3>
                  <div className="font-mono text-sm text-black/50 space-y-1 mb-6">
                    <p>Base: {formatCents(p.subtotal)}</p>
                    {p.sweetSpot && <p className="text-accent">The Sweet 4 rate applied</p>}
                    {p.nightFees > 0 && <p className="text-amber-600">Night surcharges: +{formatCents(p.nightFees)}</p>}
                    {p.sameDayFee > 0 && <p>Same-day: +{formatCents(p.sameDayFee)}</p>}
                  </div>
                  <p className="font-mono text-xs text-black/40 mb-1">Total: {formatCents(p.total)}</p>
                  <p className="font-heading text-display-sm text-accent">Deposit: {formatCents(p.deposit)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How Payment Works - Black */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-heading-xl mb-12">HOW PAYMENT WORKS</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'BOOK & PAY DEPOSIT', desc: 'Select your session details and pay a 50% deposit. Your card is saved on file.' },
              { step: '2', title: 'RECORD YOUR SESSION', desc: 'Show up, make music. Your engineer handles everything.' },
              { step: '3', title: 'REMAINDER CHARGED', desc: 'After your session, the remaining balance is charged to your card on file. The total can be adjusted for add-ons.' },
            ].map((item) => (
              <div key={item.step} className="flex gap-4">
                <span className="font-heading text-display-sm text-accent flex-shrink-0">{item.step}</span>
                <div>
                  <h3 className="text-heading-sm mb-2">{item.title}</h3>
                  <p className="font-mono text-sm text-white/60">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-display-md mb-6">LET&apos;S MAKE MUSIC</h2>
          <Link href="/book"
            className="bg-accent text-black font-mono text-lg font-bold tracking-wider uppercase px-10 py-5 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center">
            BOOK YOUR SESSION
          </Link>
        </div>
      </section>
    </>
  );
}
