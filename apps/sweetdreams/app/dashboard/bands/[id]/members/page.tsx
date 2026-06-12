import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { memberHasFlag } from '@/lib/bands';
import {
  getBandWithMembers,
  getMembership,
  getPendingInvitesForBand,
} from '@/lib/bands-server';
import DashboardNav from '@/components/layout/DashboardNav';
import MemberManagement from '@/components/bands/MemberManagement';

export const metadata: Metadata = { title: 'Band Members' };

type ProfileLookup = Record<string, { display_name: string | null; public_profile_slug: string | null }>;

/**
 * Members management page. We join profiles for each member server-side so
 * the client component gets display names without another round-trip.
 */
export default async function BandMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [bandResult, membership, pendingInvites] = await Promise.all([
    getBandWithMembers(id),
    getMembership(id, user.id),
    getPendingInvitesForBand(id),
  ]);

  if (!bandResult || !membership) notFound();
  const { band, members } = bandResult;

  // Batch-fetch profile display names for all members.
  const supabase = createServiceClient();
  const userIds = members.map((m) => m.user_id);
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('user_id, display_name, public_profile_slug')
    .in('user_id', userIds);
  const profileLookup: ProfileLookup = {};
  for (const row of profileRows || []) {
    profileLookup[row.user_id] = {
      display_name: row.display_name,
      public_profile_slug: row.public_profile_slug,
    };
  }

  const canManage = memberHasFlag(membership, 'can_manage_members');

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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href={`/dashboard/bands/${band.id}`}
            className="font-mono text-xs text-black/60 hover:text-black no-underline inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {band.display_name}
          </Link>
          <h1 className="text-heading-xl">MEMBERS</h1>
          <p className="font-mono text-sm text-black/60 mt-2">
            {canManage
              ? 'Invite bandmates, set their permissions, and manage the lineup.'
              : 'Your current lineup. Only members with manage permission can add or remove others.'}
          </p>
        </div>
      </section>

      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <MemberManagement
            bandId={band.id}
            currentUserId={user.id}
            currentUserMembership={membership}
            members={members}
            profileLookup={profileLookup}
            pendingInvites={pendingInvites}
          />
        </div>
      </section>
    </>
  );
}
