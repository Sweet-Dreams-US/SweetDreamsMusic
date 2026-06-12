import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import DashboardNav from '@/components/layout/DashboardNav';
import CreateBandForm from '@/components/bands/CreateBandForm';

export const metadata: Metadata = { title: 'Create a Band' };

/**
 * Gate: user must have a solo profile before they can create a band. A band
 * owner is always a profiled user — ownership transfers and public pages
 * depend on that.
 */
export default async function NewBandPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      <section className="bg-white text-black py-8 border-b-2 border-black/5">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard/bands"
            className="font-mono text-xs text-black/60 hover:text-black no-underline inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to bands
          </Link>
          <h1 className="text-heading-xl">CREATE A BAND</h1>
          <p className="font-mono text-sm text-black/60 mt-2">
            You&apos;ll be the band owner. You can invite members and hand off admin roles after setup.
          </p>
        </div>
      </section>

      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          {!user.profile ? (
            <div className="border-2 border-black/20 bg-black/5 p-8 text-center">
              <AlertCircle className="w-10 h-10 text-black/50 mx-auto mb-4" />
              <p className="font-mono text-body-md font-bold mb-2">PROFILE REQUIRED</p>
              <p className="font-mono text-sm text-black/70 max-w-md mx-auto mb-6">
                Set up your artist profile before creating a band. Bands inherit from your solo identity.
              </p>
              <Link
                href="/dashboard/hub"
                className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
              >
                Go to Artist Hub
              </Link>
            </div>
          ) : (
            <CreateBandForm />
          )}
        </div>
      </section>
    </>
  );
}
