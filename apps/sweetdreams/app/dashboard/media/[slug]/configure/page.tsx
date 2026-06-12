// app/dashboard/media/[slug]/configure/page.tsx
//
// Configurator entry point. Walks the buyer through each decision slot for
// configurable packages (Single Drop / EP / Album), then hands off to
// /api/media/checkout with the snapshot.
//
// Routing rules:
//   - Not logged in            → /login?redirect=/dashboard/media/<slug>/configure
//   - Offering missing/inactive → /dashboard/media (catalog)
//   - Not visible to viewer    → 404 (matches detail page behavior)
//   - Not configurable         → /dashboard/media/<slug> (just buy)
//   - Inquire-only / ranged    → /dashboard/media/<slug> (no fixed price to configure)
//
// The page is a thin server shell — all interactivity lives in
// `<MediaConfigurator>`. Server's job: load + authorize, then render.
//
// Spec: SweetDreamsMusicVault/Features/Media-Booking-Hub.md

import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getOfferingBySlug } from '@/lib/media-server';
import { getUserBands } from '@/lib/bands-server';
import { isOfferingVisibleTo, viewerEligibilityFromBands } from '@/lib/media';
import { isOfferingConfigurable } from '@/lib/media-config';
import { getBrand } from '@/lib/brand-server';
import DashboardNav from '@/components/layout/DashboardNav';
import MediaConfigurator from '@/components/media/MediaConfigurator';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const offering = await getOfferingBySlug(slug);
  const brand = await getBrand();
  return {
    title: offering ? `Configure ${offering.title} — ${brand.name}` : 'Configure',
  };
}

export default async function ConfigurePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/dashboard/media/${slug}/configure`);

  const offering = await getOfferingBySlug(slug);
  if (!offering || !offering.is_active) redirect('/dashboard/media');

  // Visibility check — same rule as the detail page.
  const bandMemberships = await getUserBands(user.id);
  const viewer = viewerEligibilityFromBands({
    authenticated: true,
    bandCount: bandMemberships.length,
  });
  if (!isOfferingVisibleTo(offering, viewer)) notFound();

  // No configuration to make → bounce back to the detail page where they
  // can either buy directly or send an inquiry. The configurator should
  // never be a dead-end screen.
  if (!isOfferingConfigurable(offering) || offering.price_cents == null) {
    redirect(`/dashboard/media/${slug}`);
  }

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <MediaConfigurator offering={offering} />
    </>
  );
}
