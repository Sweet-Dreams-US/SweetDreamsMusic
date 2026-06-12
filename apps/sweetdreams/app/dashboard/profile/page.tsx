import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import DashboardNav from '@/components/layout/DashboardNav';
import ProfileEditor from '@/components/profile/ProfileEditor';

export const metadata: Metadata = { title: 'Edit Profile' };

export default async function ProfileEditPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <>
      <DashboardNav
        role={user.role}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <section className="bg-white text-black py-8 sm:py-12">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-heading-lg mb-8">EDIT PROFILE</h2>
          <ProfileEditor
            userId={user.id}
            profileSlug={user.profile?.public_profile_slug || ''}
          />
        </div>
      </section>
    </>
  );
}
