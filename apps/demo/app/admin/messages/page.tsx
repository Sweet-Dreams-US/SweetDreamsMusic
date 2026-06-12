import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getBrand } from '@/lib/brand-server';
import DashboardNav from '@/components/layout/DashboardNav';
import AdminMessagesClient from './AdminMessagesClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: `Support Queue — Admin — ${brand.name}`,
  };
}

export default async function AdminMessagesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?redirect=/admin/messages');
  if (user.role !== 'admin') redirect('/dashboard');

  const b = await getBrand();

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
            Admin · Support Queue
          </p>
          <h1 className="text-heading-xl mb-2">{b.name.toUpperCase()} THREADS</h1>
          <p className="font-mono text-xs text-black/60 max-w-2xl mb-6">
            Every user&apos;s official {b.name} thread. Threads where a buyer or producer is
            waiting for a reply are highlighted. Click a thread to open it in the inbox.
          </p>
          <AdminMessagesClient />
        </div>
      </section>
    </>
  );
}
