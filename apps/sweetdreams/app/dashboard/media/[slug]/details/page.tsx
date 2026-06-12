// app/dashboard/media/[slug]/details/page.tsx
//
// Step 3 of the media booking flow (project details questionnaire).
// Buyer fills out artist/song/vibe/references info, then submits — the
// form's submit POSTs straight to /api/media/checkout, which now accepts
// project_details alongside the existing slug + configured_components.
//
// Routing rules:
//   - Not logged in            → /login?redirect=...
//   - Offering missing/inactive → /dashboard/media
//   - Not visible to viewer    → 404
//   - Inquire-only / ranged    → bounce back to /[slug] (those flows
//                                 use the inquiry form, not this one)
//
// For configurable packages, the form expects to find a configurator
// snapshot in window.sessionStorage at key `media-config:${slug}`. The
// configure wizard writes it there before navigating to this page.

import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getOfferingBySlug } from '@/lib/media-server';
import { getUserBands } from '@/lib/bands-server';
import {
  isOfferingVisibleTo,
  viewerEligibilityFromBands,
  formatOfferingPrice,
} from '@/lib/media';
import { isOfferingConfigurable } from '@/lib/media-config';
import DashboardNav from '@/components/layout/DashboardNav';
import MediaProjectDetailsForm from '@/components/media/MediaProjectDetailsForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const offering = await getOfferingBySlug(slug);
  return {
    title: offering ? `Project Details — ${offering.title}` : 'Project Details',
  };
}

export default async function ProjectDetailsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/dashboard/media/${slug}/details`);

  const offering = await getOfferingBySlug(slug);
  if (!offering || !offering.is_active) redirect('/dashboard/media');

  const bandMemberships = await getUserBands(user.id);
  const viewer = viewerEligibilityFromBands({
    authenticated: true,
    bandCount: bandMemberships.length,
  });
  if (!isOfferingVisibleTo(offering, viewer)) notFound();

  // Range / inquire-only offerings don't go through checkout — those
  // route through the inquiry form. Send the user back to the detail
  // page where the correct CTA renders.
  const hasFixedPrice =
    offering.price_cents != null &&
    offering.price_range_low_cents == null &&
    offering.price_range_high_cents == null;
  if (!hasFixedPrice) {
    redirect(`/dashboard/media/${slug}`);
  }

  const configurable = isOfferingConfigurable(offering);

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
          <Link
            href={
              configurable
                ? `/dashboard/media/${slug}/configure`
                : `/dashboard/media/${slug}`
            }
            className="font-mono text-xs text-black/60 hover:text-black no-underline inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            {configurable ? 'Back to configurator' : 'Back to offering'}
          </Link>

          <p className="font-mono text-xs uppercase tracking-wider text-black/50 mb-2">
            Project details
          </p>
          <h1 className="text-heading-xl mb-3">{offering.title}</h1>
          <p className="font-mono text-sm text-black/60 mb-2">
            Total to charge:{' '}
            <span className="font-bold text-black">
              {formatOfferingPrice(offering)}
            </span>
            {configurable && (
              <span className="text-black/40"> (after your configuration)</span>
            )}
          </p>
          <p className="font-mono text-sm text-black/60 mb-8 max-w-xl">
            Tell us about the project so the production team can prep before
            your first session. We&apos;ll fold this into your order so the
            engineer reads it the moment they pick up the work.
          </p>

          <MediaProjectDetailsForm
            slug={offering.slug}
            offeringTitle={offering.title}
            isConfigurable={configurable}
          />
        </div>
      </section>
    </>
  );
}
