'use client';

// components/hub/AvailableBalances.tsx
//
// Overview surfacing of an artist's spendable balances — STUDIO HOURS (prepaid
// studio time / free-hour credits) and MEDIA CREDITS (per-deliverable). These
// already live in the Media tab (HubMedia), but the owner asked for them to be
// visible the moment an artist lands on the Hub. This is a PURE presentational
// component: it receives the same balances the Media tab reads (passed down
// from the server via `relocated.media`) and renders nothing when everything is
// empty. Accessors mirror HubMedia exactly so the two surfaces stay in sync.
//
// Booking CTAs:
//   • Free studio hour → /dashboard/media/credits (the $0 credit-redemption flow).
//   • Schedule a media shoot → switches to the Media tab (onNavigate('media')),
//     where HubMedia's "Schedule a shoot" picker turns owned credits into dated
//     requests — the same flow HubMedia links to.
//
// Discounts (issued reward grants) are intentionally NOT shown here. They'd
// require a client fetch of /api/hub/rewards (loading + error states), which the
// dedicated Perks tab already owns; keeping this component fetch-free preserves
// its pure/presentational nature. Hours + media credits are the priority.

import Link from 'next/link';
import { Wallet, Film, ArrowRight, CalendarPlus } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import type { MediaCreditBalance } from '@/lib/media-credits';

export default function AvailableBalances({
  studioHours,
  mediaCredits,
  onNavigate,
}: {
  studioHours: { hoursRemaining: number; costBasisCents: number };
  mediaCredits: MediaCreditBalance[];
  onNavigate?: (tab: string) => void;
}) {
  const hasHours = studioHours.hoursRemaining > 0;
  const hasMedia = mediaCredits.length > 0;

  // Nothing to show — render nothing (the Overview already has a permanent
  // "Book a Studio Session" entry for empty-balance artists).
  if (!hasHours && !hasMedia) return null;

  return (
    <div className="border-2 border-black/10 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wallet className="w-4 h-4 text-accent" />
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider">
          Available Balances
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* STUDIO HOURS — free / prepaid studio time. */}
        {hasHours && (
          <div className="border-2 border-accent bg-accent/5 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-accent" />
              <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                Studio Hours
              </p>
            </div>
            <p className="font-mono text-sm font-bold mb-1">
              {studioHours.hoursRemaining.toFixed(1)} free studio hour
              {studioHours.hoursRemaining === 1 ? '' : 's'} available
            </p>
            <p className="font-mono text-xs text-black/60 mb-3">
              Prepaid studio time, ready to book.
              {studioHours.costBasisCents > 0 && (
                <> Value: {formatCents(studioHours.costBasisCents)}.</>
              )}
            </p>
            <Link
              href="/dashboard/media/credits"
              className="mt-auto font-mono text-[11px] font-bold uppercase tracking-wider bg-accent text-black px-3 py-2 hover:opacity-80 transition-opacity duration-200 inline-flex items-center justify-center gap-1 no-underline"
            >
              Book your free hour <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        )}

        {/* MEDIA CREDITS — per-deliverable balance. */}
        {hasMedia && (
          <div className="border-2 border-black/10 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <Film className="w-4 h-4 text-accent" />
              <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
                Media Balance
              </p>
            </div>
            <ul className="space-y-1.5 mb-3">
              {mediaCredits.map((c) => (
                <li
                  key={c.credit_kind}
                  className="flex items-center justify-between font-mono text-sm"
                >
                  <span className="text-black/70">{c.label}</span>
                  <span className="font-bold">{c.remaining}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => onNavigate?.('media')}
              className="mt-auto font-mono text-[11px] font-bold uppercase tracking-wider border-2 border-black/10 text-black px-3 py-2 hover:border-accent/30 transition-colors duration-200 inline-flex items-center justify-center gap-1"
            >
              <CalendarPlus className="w-3 h-3" /> Schedule a shoot
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
