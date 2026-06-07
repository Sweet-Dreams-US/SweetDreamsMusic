import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SITE_URL } from '@/lib/constants';
import { STUDIO_IMAGES } from '@/lib/images';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { memberHasFlag } from '@/lib/bands';
import { getMembership } from '@/lib/bands-server';
import { getStudioConfigs } from '@/lib/studio-config-server';
import { getEngineers } from '@/lib/engineers-server';
import BookingFlow from '@/components/booking/BookingFlow';

export const metadata: Metadata = {
  title: 'Book a Recording Session — Schedule Online',
  description: 'Book your recording session at Sweet Dreams Music in Fort Wayne, IN. Choose your date, time, studio, and engineer. Sessions starting at $50/hour with 50% deposit. Open 24/7.',
  alternates: { canonical: `${SITE_URL}/book` },
  openGraph: {
    title: 'Book a Recording Session | Sweet Dreams Music — Fort Wayne, IN',
    description: 'Schedule your recording session online. Choose your studio, engineer, date, and time. Starting at $50/hour with 50% deposit booking.',
    url: `${SITE_URL}/book`,
    type: 'website',
  },
};

/**
 * /book — the unified booking page. Two modes:
 *
 *   1. Solo (default) — classic flow, any studio, per-hour pricing.
 *   2. Band — entered via `?bandId=<uuid>`. Requires auth AND membership
 *      AND `can_book_band_sessions`. Locks to Studio A + flat-rate 4h/8h.
 *
 * We resolve band mode server-side so that permission errors render as
 * a real page (not a client-side fall-through), and so BookingFlow
 * receives a ready-to-use `band` object instead of having to fetch.
 */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ bandId?: string }>;
}) {
  const user = await getSessionUser();
  const { bandId } = await searchParams;

  // DB-driven room configs (rates / hours / guest rules / tiers / surcharges).
  // Same config the charge uses, so the booking UI and /api/booking/create can
  // never disagree. Constants fallback is baked into getStudioConfigs.
  const studios = await getStudioConfigs(createServiceClient());
  const engineers = await getEngineers();

  // Resolve band mode if ?bandId present. Four outcomes:
  //   - no bandId             → solo mode (band = null)
  //   - bandId but no user    → show "sign in required"
  //   - bandId but no permit  → show "not authorized" with a link back
  //   - bandId + permit       → pass band to BookingFlow
  let band: { id: string; display_name: string } | null = null;
  let bandError: 'not_member' | 'not_found' | null = null;
  if (bandId && user) {
    const supabase = createServiceClient();
    const { data: bandRow } = await supabase
      .from('bands')
      .select('id, display_name')
      .eq('id', bandId)
      .maybeSingle();
    if (!bandRow) {
      bandError = 'not_found';
    } else {
      const membership = await getMembership(bandId, user.id);
      if (!membership || !memberHasFlag(membership, 'can_book_band_sessions')) {
        // Collapse "not a member" and "no permission" into one error —
        // the user can't act on either, so the distinction is UX noise.
        bandError = 'not_member';
      } else {
        band = { id: bandRow.id, display_name: bandRow.display_name };
      }
    }
  }

  return (
    <>
      {/* Hero */}
      <section className="relative bg-black text-white py-16 sm:py-20 overflow-hidden">
        <Image
          src={STUDIO_IMAGES.akgMicWide}
          alt=""
          fill
          className="object-cover opacity-20"
          priority
          sizes="100vw"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            {band ? `Booking for ${band.display_name}` : 'Get Started'}
          </p>
          <h1 className="text-display-md mb-4">
            {band ? 'BOOK A BAND SESSION' : 'BOOK YOUR SESSION'}
          </h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            {band
              ? 'Band sessions run in Studio A at a flat rate — no surcharges stack. Pick a date, time, and tier to lock it in with a 50% deposit.'
              : 'Select your date, time, and session details below. Pay a 50% deposit to lock in your session.'}
          </p>
        </div>
      </section>

      {/* Booking Flow - White */}
      <section className="bg-white text-black py-12 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {bandError === 'not_found' ? (
            <div className="text-center py-16">
              <h2 className="text-heading-lg mb-4">BAND NOT FOUND</h2>
              <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-8">
                We couldn&apos;t find that band. The link may be outdated, or the band may have been removed.
              </p>
              <Link
                href="/book"
                className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
              >
                BOOK A SOLO SESSION
              </Link>
            </div>
          ) : bandError === 'not_member' ? (
            <div className="text-center py-16">
              <h2 className="text-heading-lg mb-4">NOT AUTHORIZED</h2>
              <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-8">
                You don&apos;t have permission to book sessions for this band. Ask the band owner to grant you the &ldquo;book sessions&rdquo; permission.
              </p>
              <Link
                href="/book"
                className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
              >
                BOOK A SOLO SESSION
              </Link>
            </div>
          ) : user ? (
            <BookingFlow
              userName={user.profile?.display_name || ''}
              userEmail={user.email}
              studios={studios}
              engineers={engineers}
              band={band}
            />
          ) : (
            <div className="text-center py-16">
              <h2 className="text-heading-lg mb-4">CREATE AN ACCOUNT TO BOOK</h2>
              <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-8">
                You need an account to book a session. Sign up to see the schedule, book sessions, and manage your recordings.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href={`/login?redirect=${bandId ? `/book?bandId=${bandId}` : '/book'}`}
                  className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
                >
                  SIGN UP / LOG IN
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
