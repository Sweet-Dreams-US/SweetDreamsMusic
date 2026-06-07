import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getStudioConfigs } from '@/lib/studio-config-server';
import { getEngineers } from '@/lib/engineers-server';
import EngineerDashboard from '@/components/engineer/EngineerDashboard';
import DashboardNav from '@/components/layout/DashboardNav';

export const metadata: Metadata = { title: 'Engineer Dashboard' };

export default async function EngineerPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'engineer' && user.role !== 'admin') redirect('/dashboard');

  // DB-driven room configs for the invite flow's pricing (matches the charge).
  const studios = await getStudioConfigs(createServiceClient());
  const engineers = await getEngineers();

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <EngineerDashboard user={user} studios={studios} engineers={engineers} />
    </>
  );
}
