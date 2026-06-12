import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { memberHasFlag } from '@/lib/bands';
import { getBandWithMembers, getMembership } from '@/lib/bands-server';
import DashboardNav from '@/components/layout/DashboardNav';
import EditBandForm from '@/components/bands/EditBandForm';

export const metadata: Metadata = { title: 'Edit Band' };

/**
 * Gated by `can_edit_public_page`. Owner always has it; admins/members only
 * if the owner toggled it on.
 */
export default async function EditBandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [bandResult, membership] = await Promise.all([
    getBandWithMembers(id),
    getMembership(id, user.id),
  ]);

  if (!bandResult || !membership) notFound();
  if (!memberHasFlag(membership, 'can_edit_public_page')) {
    redirect(`/dashboard/bands/${id}`);
  }

  const { band } = bandResult;

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
            href={`/dashboard/bands/${band.id}`}
            className="font-mono text-xs text-black/60 hover:text-black no-underline inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {band.display_name}
          </Link>
          <h1 className="text-heading-xl">EDIT BAND</h1>
          <p className="font-mono text-sm text-black/60 mt-2">
            Update your band&apos;s public page. Changes publish immediately.
          </p>
        </div>
      </section>

      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <EditBandForm band={band} isOwner={membership.role === 'owner'} />
        </div>
      </section>
    </>
  );
}
