import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getBrand } from '@/lib/brand-server';
import DashboardNav from '@/components/layout/DashboardNav';
import InboxClient from './InboxClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: `Inbox — ${brand.name}`,
  };
}

export default async function InboxPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?redirect=/dashboard/inbox');

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
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-2">
            Inbox
          </p>
          <h1 className="text-heading-xl mb-6">YOUR CONVERSATIONS</h1>
          <InboxClient />
        </div>
      </section>
    </>
  );
}
