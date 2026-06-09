import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import DashboardNav from '@/components/layout/DashboardNav';
import AgentStatsConsole from '@/components/agent/AgentStatsConsole';

export const metadata: Metadata = { title: 'Agent Stats Console' };

// The Cowork agent's work surface: walk today's queue of active artists, open
// each pasted platform link, record the public numbers. Gate mirrors
// app/media-team/page.tsx — agent or admin only.
export default async function AgentStatsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'agent' && user.role !== 'admin') redirect('/dashboard');

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <section className="bg-white text-black min-h-[60vh]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <AgentStatsConsole />
        </div>
      </section>
    </>
  );
}
