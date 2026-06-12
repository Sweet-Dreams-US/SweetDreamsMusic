import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bell } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import DashboardNav from '@/components/layout/DashboardNav';
import UpdatesLog from '@/components/dashboard/UpdatesLog';

export const metadata: Metadata = { title: 'Updates' };

export default async function UpdatesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const profileSlug = user.profile?.public_profile_slug || undefined;

  // Determine if user is a producer
  const isProducer = user.is_producer || false;

  return (
    <>
      <DashboardNav
        role={user.role}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={profileSlug}
      />

      <section className="bg-white text-black py-8 sm:py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-heading-lg flex items-center gap-3">
                <Bell className="w-7 h-7 text-accent" />
                UPDATES
              </h2>
              <p className="font-mono text-xs text-black/40 mt-2">
                See what&apos;s new on the platform. Updates are filtered to show what&apos;s relevant to you.
              </p>
            </div>
            <Link href="/dashboard" className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1 no-underline">
              <ArrowLeft className="w-3 h-3" /> Dashboard
            </Link>
          </div>

          <UpdatesLog userRole={user.role} isProducer={isProducer} />
        </div>
      </section>
    </>
  );
}
