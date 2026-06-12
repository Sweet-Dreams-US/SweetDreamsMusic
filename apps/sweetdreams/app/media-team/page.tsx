import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import DashboardNav from '@/components/layout/DashboardNav';
import MediaManagerDashboard from '@/components/media-team/MediaManagerDashboard';

export const metadata: Metadata = { title: 'Media Team' };

// Media-team work surface — the media analog of /engineer. Gated to the
// media_manager role (admins always pass). Mirrors app/engineer/page.tsx.
export default async function MediaTeamPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'media_manager' && user.role !== 'admin') redirect('/dashboard');

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <MediaManagerDashboard />
    </>
  );
}
