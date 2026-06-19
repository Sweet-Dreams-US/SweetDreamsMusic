import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getMediaManagerRoster } from '@/lib/media-team-server';
import { createServiceClient } from '@/lib/supabase/server';
import DashboardNav from '@/components/layout/DashboardNav';
import ContractBuilder from '@/components/media-team/ContractBuilder';

export const metadata: Metadata = { title: 'New Project — Contract Builder' };

// Dedicated contract-builder route in the Media Team area. The media analog of
// /book — a full-page, site-styled flow (NOT the cramped admin modal) for a
// media manager to author a complete media project as a CONTRACT:
//   1. Client          (pick existing or invite by email)
//   2. Production logistics (one or more planned shoots — no sessions yet)
//   3. Campaign deliverables (priced line items from offering slots or custom)
//   4. Total investment (derived from deliverables)
//   5. Payment schedule (installment plan that must equal the total)
//   6. Authorization   (terms + send-to-artist-for-signature)
//
// On submit it POSTs the contract-create body, then send-contract (manager
// signs + emails the artist). Gated to media_manager + admin, same as the
// Media Team work surface.
export default async function NewContractPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'media_manager' && user.role !== 'admin') redirect('/dashboard');

  // The media-manager roster (role media_manager/admin + super-admins) drives
  // the per-shoot "media manager in charge" picker — the people actually allowed
  // to run media work. We resolve each chosen manager server-side at finalize, so
  // we feed the picker user_id + display name (not a free-text string).
  const service = createServiceClient();
  const managers = await getMediaManagerRoster(service);
  const mediaManagers = managers.map((m) => ({
    user_id: m.user_id,
    name: m.display_name || m.email || 'Unnamed manager',
  }));

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <ContractBuilder mediaManagers={mediaManagers} />
    </>
  );
}
