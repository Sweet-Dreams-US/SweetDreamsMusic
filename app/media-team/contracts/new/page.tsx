import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getEngineers } from '@/lib/engineers-server';
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

  // Engineer roster for the production-logistics picker. We pass display names
  // because planned_shoots carries engineer_name (a display string), matching
  // the create API contract.
  const engineers = await getEngineers();
  const engineerNames = engineers.map((e) => e.displayName);

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />
      <ContractBuilder engineerNames={engineerNames} />
    </>
  );
}
