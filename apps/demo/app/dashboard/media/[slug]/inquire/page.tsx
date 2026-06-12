// app/dashboard/media/[slug]/inquire/page.tsx
//
// Inquiry form for offerings that can't auto-checkout — range-priced
// (Premium MV $1,500–$5,000) or inquire-only (Sweet Spot Individual,
// band-by-request packages). The form captures scope details, fires off
// an email to Jay + Cole, and writes a `media_bookings` row with
// status='inquiry' so the lead is tracked in our own system, not just
// the inbox.
//
// Routing rules:
//   - Not logged in            → /login?redirect=...
//   - Offering missing/inactive → /dashboard/media
//   - Not visible to viewer    → 404
//   - Has a fixed price (no range, no inquire) → /dashboard/media/<slug>
//     (those buyers should hit the buy button or wizard, not this form)
//
// Spec: SweetDreamsMusicVault/Features/Media-Booking-Hub.md

import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getOfferingBySlug } from '@/lib/media-server';
import { getUserBands } from '@/lib/bands-server';
import {
  formatOfferingPrice,
  isOfferingVisibleTo,
  viewerEligibilityFromBands,
} from '@/lib/media';
import DashboardNav from '@/components/layout/DashboardNav';
import MediaInquiryForm from '@/components/media/MediaInquiryForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const offering = await getOfferingBySlug(slug);
  return {
    title: offering ? `Inquire — ${offering.title}` : 'Inquire',
  };
}

export default async function InquirePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/dashboard/media/${slug}/inquire`);

  const offering = await getOfferingBySlug(slug);
  if (!offering || !offering.is_active) redirect('/dashboard/media');

  const bandMemberships = await getUserBands(user.id);
  const viewer = viewerEligibilityFromBands({
    authenticated: true,
    bandCount: bandMemberships.length,
  });
  if (!isOfferingVisibleTo(offering, viewer)) notFound();

  // Inquiry only makes sense when there's no fixed price. If the offering
  // is fully buyable, send the user back to the detail page where they
  // can either buy directly or open the wizard.
  const hasFixedPrice =
    offering.price_cents != null &&
    offering.price_range_low_cents == null &&
    offering.price_range_high_cents == null;
  if (hasFixedPrice) {
    redirect(`/dashboard/media/${slug}`);
  }

  // Pre-select the band attribution if the user is in exactly one band.
  // Multi-band buyers pick the band in the form itself.
  const candidateBands = bandMemberships.map((m) => ({
    id: m.band_id,
    name: m.band.display_name,
  }));

  // Round 7: phone is now required on inquiries. Pre-fill from profile
  // so returning buyers don't re-enter. The form persists what they
  // type back to profile.phone via the inquiry API.
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('phone')
    .eq('user_id', user.id)
    .maybeSingle();
  const profilePhone = (profileRow as { phone: string | null } | null)?.phone ?? null;

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      <section className="bg-white text-black min-h-[80vh]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <p className="font-mono text-xs uppercase tracking-wider text-black/50 mb-2">
            Send an inquiry
          </p>
          <h1 className="text-heading-xl mb-3">{offering.title}</h1>
          <p className="font-mono text-sm text-black/60 mb-8">
            Pricing: <span className="font-bold text-black">{formatOfferingPrice(offering)}</span>
            {offering.price_range_low_cents != null && (
              <> — final cost depends on scope.</>
            )}
          </p>

          {offering.public_blurb && (
            <p className="text-base text-black/80 mb-8">{offering.public_blurb}</p>
          )}

          <MediaInquiryForm
            slug={offering.slug}
            offeringTitle={offering.title}
            defaultName={user.profile?.display_name ?? ''}
            defaultEmail={user.email}
            defaultPhone={profilePhone}
            candidateBands={candidateBands}
          />
        </div>
      </section>
    </>
  );
}
