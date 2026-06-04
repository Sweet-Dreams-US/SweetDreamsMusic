import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getUserBands, getPendingInvitesForEmail } from '@/lib/bands-server';
import { getEventsForUser, getPendingEventInvitesForEmail } from '@/lib/events-server';
import { getActiveOfferings, getStudioCreditBalanceForUser, getMediaCreditsForOwner } from '@/lib/media-server';
import { getMediaBookingsForOwner } from '@/lib/media-scheduling-server';
import { groupOfferings, isOfferingVisibleTo, viewerEligibilityFromBands } from '@/lib/media';
import DashboardNav from '@/components/layout/DashboardNav';
import ArtistHub, { type HubRelocatedData } from '@/components/hub/ArtistHub';
import PendingInvitesBanner from '@/components/bands/PendingInvitesBanner';

export const metadata: Metadata = { title: 'Artist Hub' };

// The Hub now hosts the relocated Media / Events / Bands tabs, so it fetches
// their data server-side (one batch) and passes it down. Reads are cheap +
// indexed; force-dynamic keeps balances/orders fresh after a purchase.
export const dynamic = 'force-dynamic';

export default async function ArtistHubPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // ?tab=media|events|bands|… deep-links straight to a Hub sub-tab (used by
  // cross-links + old /dashboard/{media,events,bands} bookmarks once the nav
  // flips). Validated against the tab list inside ArtistHub.
  const { tab: initialTab } = await searchParams;

  // Band memberships first — they gate media viewer-eligibility + feed the
  // Bands tab. Then fan out everything else in parallel.
  const memberships = await getUserBands(user.id);
  const bandIds = memberships.map((m) => m.band_id);
  const viewer = viewerEligibilityFromBands({ authenticated: true, bandCount: memberships.length });

  const supabase = await createClient();
  const [
    bandInvites,
    myEvents,
    eventInvites,
    allOfferings,
    studioHours,
    mediaCredits,
    orders,
    { data: profileRow },
  ] = await Promise.all([
    getPendingInvitesForEmail(user.email),
    getEventsForUser(user.id),
    getPendingEventInvitesForEmail(user.email),
    getActiveOfferings(),
    getStudioCreditBalanceForUser(user.id),
    getMediaCreditsForOwner({ userId: user.id, bandIds }),
    getMediaBookingsForOwner({ userId: user.id, bandIds }),
    supabase.from('profiles').select('phone').eq('user_id', user.id).maybeSingle(),
  ]);

  const visibleOfferings = allOfferings.filter((o) => isOfferingVisibleTo(o, viewer));
  const { packages, services } = groupOfferings(visibleOfferings);
  const profilePhone = (profileRow as { phone: string | null } | null)?.phone ?? null;

  const relocated: HubRelocatedData = {
    media: {
      packages,
      services,
      profilePhone,
      isAdmin: user.role === 'admin',
      credits: mediaCredits,
      studioHours,
      orderCount: orders.length,
    },
    events: { myEvents, pendingInvites: eventInvites },
    bands: { memberships, pendingInvites: bandInvites, hasProfile: !!user.profile },
  };

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <PendingInvitesBanner invites={bandInvites} />
      <ArtistHub userId={user.id} relocated={relocated} initialTab={initialTab} />
    </>
  );
}
