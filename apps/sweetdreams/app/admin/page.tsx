import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import AdminDashboard from '@/components/admin/AdminDashboard';
import DashboardNav from '@/components/layout/DashboardNav';

export const metadata: Metadata = { title: 'Admin Dashboard' };

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/dashboard');

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <AdminDashboard user={user} />
    </>
  );
}
