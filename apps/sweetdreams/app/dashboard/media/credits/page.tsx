// app/dashboard/media/credits/page.tsx
//
// Phase E credit-redemption surface. Lists the user's prepaid balances
// (personal + each band they're a member of) and lets them book studio
// time against any of them. The /book flow is intentionally NOT touched
// — this is a parallel surface that creates `bookings` rows with $0 cost
// and a linking `studio_credit_redemptions` row.
//
// If the user has no credits, the page redirects back to the catalog
// where they can buy a package that grants studio hours.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Wallet } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getUserBands } from '@/lib/bands-server';
import { createServiceClient } from '@/lib/supabase/server';
import { ENGINEERS } from '@/lib/constants';
import { formatCents } from '@/lib/utils';
import DashboardNav from '@/components/layout/DashboardNav';
import MediaCreditBookingForm from '@/components/media/MediaCreditBookingForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Use Prepaid Hours — Sweet Dreams Media',
};

export default async function CreditsBookingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?redirect=/dashboard/media/credits');

  const bandMemberships = await getUserBands(user.id);
  const service = createServiceClient();

  // Fetch every credit pool the user can spend from: their personal credits
  // AND credits attached to any band they're a member of. We surface them
  // as separate "wallets" so the buyer picks which to draw from.
  const bandIds = bandMemberships.map((m) => m.band_id);
  let creditQuery = service
    .from('studio_credits')
    .select('id, user_id, band_id, hours_granted, hours_used, cost_basis_cents, created_at');
  if (bandIds.length > 0) {
    creditQuery = creditQuery.or(
      `user_id.eq.${user.id},band_id.in.(${bandIds.join(',')})`,
    );
  } else {
    creditQuery = creditQuery.eq('user_id', user.id);
  }
  const { data: creditsRaw } = await creditQuery;
  type CreditRow = {
    id: string;
    user_id: string | null;
    band_id: string | null;
    hours_granted: number;
    hours_used: number;
    cost_basis_cents: number | null;
    created_at: string;
  };
  const credits = (creditsRaw || []) as CreditRow[];

  // Aggregate per pool: personal user, or per band. Each pool sums all
  // outstanding credits attached to it. Empty pools (hours_remaining === 0)
  // are excluded — they shouldn't appear as bookable wallets.
  const bandNameById = new Map(bandMemberships.map((m) => [m.band_id, m.band.display_name]));
  type Pool = {
    id: string; // single credit_id we pick to drain (FIFO — oldest first)
    label: string;
    ownerType: 'user' | 'band';
    bandId: string | null;
    hoursRemaining: number;
    liabilityCents: number;
  };
  const poolMap = new Map<string, Pool>();
  // Sort credits oldest first so FIFO drains correctly; multiple credits in
  // one pool will need a separate "split across credits" booking flow in v2.
  credits.sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const c of credits) {
    const remaining = Number(c.hours_granted) - Number(c.hours_used);
    if (remaining <= 0) continue;
    const key = c.band_id ? `band:${c.band_id}` : `user:${c.user_id}`;
    const existing = poolMap.get(key);
    if (existing) {
      existing.hoursRemaining += remaining;
      existing.liabilityCents += c.cost_basis_cents ?? 0;
      // Keep the first (oldest) credit's id as the drain target. v2 can
      // split a long booking across multiple credits in the same pool.
    } else {
      poolMap.set(key, {
        id: c.id,
        label: c.band_id
          ? `${bandNameById.get(c.band_id) ?? 'Band'} (band balance)`
          : 'Your personal balance',
        ownerType: c.band_id ? 'band' : 'user',
        bandId: c.band_id,
        hoursRemaining: remaining,
        liabilityCents: c.cost_basis_cents ?? 0,
      });
    }
  }
  const pools = Array.from(poolMap.values());

  // No credits → push them back to the catalog. The empty-state copy lives
  // there already (the dashboard hub's prepaid-balance widget renders "0 hrs").
  if (pools.length === 0) {
    redirect('/dashboard/media');
  }

  // Engineer roster — for the dropdown. Pass through what the form needs;
  // the API re-validates so client tampering can't corrupt the assignment.
  const engineerOptions = ENGINEERS.map((e) => ({
    name: e.name,
    displayName: e.displayName,
    studios: [...e.studios],
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

      <section className="bg-white text-black min-h-[80vh]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            href="/dashboard/media"
            className="font-mono text-xs text-black/60 hover:text-black no-underline inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Media Hub
          </Link>

          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-5 h-5 text-accent" />
            <p className="font-mono text-xs uppercase tracking-wider text-black/50">
              Use prepaid hours
            </p>
          </div>
          <h1 className="text-heading-xl mb-4">BOOK STUDIO TIME WITH CREDITS</h1>
          <p className="font-mono text-sm text-black/60 mb-8 max-w-xl">
            Studio time you already paid for via a media package. Pick a wallet,
            schedule a session, and we&apos;ll draw it down — no Stripe charge.
          </p>

          {/* Wallet snapshot — every pool shown so multi-band members see all options at a glance */}
          <div className="border-2 border-black/10 p-5 mb-8 space-y-2">
            <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-2">
              Your wallets
            </p>
            {pools.map((p) => (
              <div
                key={`${p.ownerType}:${p.bandId ?? user.id}`}
                className="flex items-baseline justify-between text-sm border-b border-black/5 pb-2 last:border-b-0 last:pb-0"
              >
                <span className="font-bold">{p.label}</span>
                <span className="font-mono text-xs">
                  <strong>{p.hoursRemaining.toFixed(1)} hr</strong>
                  {p.liabilityCents > 0 && (
                    <span className="text-black/40 ml-2">value {formatCents(p.liabilityCents)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <MediaCreditBookingForm pools={pools} engineers={engineerOptions} />
        </div>
      </section>
    </>
  );
}
