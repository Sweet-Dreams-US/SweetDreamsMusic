'use client';

// components/dashboard/DashboardBalances.tsx
//
// Thin client wrapper that mounts the presentational AvailableBalances on the
// MAIN dashboard (/dashboard). AvailableBalances is reused as-is from the Artist
// Hub: its Studio-Hours CTA is already a <Link href="/dashboard/media/credits">,
// and its "Schedule a shoot" button calls onNavigate(tab). The Hub is a tabbed
// shell so onNavigate switches tabs; /dashboard is NOT tabbed, so here we map the
// callback to a plain route push to the standalone media page. The component
// renders nothing when both balances are empty, so this adds no visual noise for
// artists with no credits.

import { useRouter } from 'next/navigation';
import AvailableBalances from '@/components/hub/AvailableBalances';
import type { MediaCreditBalance } from '@/lib/media-credits';

export default function DashboardBalances({
  studioHours,
  mediaCredits,
}: {
  studioHours: { hoursRemaining: number; costBasisCents: number };
  mediaCredits: MediaCreditBalance[];
}) {
  const router = useRouter();
  return (
    <AvailableBalances
      studioHours={studioHours}
      mediaCredits={mediaCredits}
      onNavigate={() => router.push('/dashboard/media')}
    />
  );
}
