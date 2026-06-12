import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import DashboardNav from '@/components/layout/DashboardNav';
import ProducerDashboard from '@/components/producer/ProducerDashboard';

export const metadata: Metadata = { title: 'Producer Dashboard' };

export default async function ProducerPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.is_producer) redirect('/dashboard');

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.producer_name || user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <ProducerDashboard isAdmin={user.role === 'admin'} />
    </>
  );
}
