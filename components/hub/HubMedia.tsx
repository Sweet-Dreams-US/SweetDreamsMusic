'use client';

// Artist Hub → Media tab. Relocates the logged-in media hub
// (/dashboard/media) into the Artist Hub. Shows the combined balance
// (per-deliverable media credits + prepaid studio hours) and the full
// catalog (MediaCatalogClient, which owns its own cart). Buy/configure/
// checkout happen inline via the catalog; scheduling owned credits arrives
// in Phase 5. Deep order management links out to /dashboard/media/orders.

import Link from 'next/link';
import { ArrowRight, Wallet, Calendar, Film } from 'lucide-react';
import MediaCatalogClient from '@/components/media/MediaCatalogClient';
import { formatCents } from '@/lib/utils';
import type { MediaOffering } from '@/lib/media';
import type { MediaCreditBalance } from '@/lib/media-credits';

export default function HubMedia({
  packages,
  services,
  profilePhone,
  isAdmin,
  mediaCredits,
  studioHours,
  orderCount,
}: {
  packages: MediaOffering[];
  services: MediaOffering[];
  profilePhone: string | null;
  isAdmin: boolean;
  mediaCredits: MediaCreditBalance[];
  studioHours: { hoursRemaining: number; costBasisCents: number };
  orderCount: number;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-heading-md flex items-center gap-3">
          <Film className="w-6 h-6 text-accent" />
          MEDIA
        </h2>
        <p className="font-mono text-sm text-black/60 mt-1">
          Browse and book media services and packages. What you buy lands on your account as a
          balance to schedule when you&apos;re ready.
        </p>
      </div>

      {/* Balance + orders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Media credits (deliverables) */}
        <div className="border-2 border-black/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Film className="w-4 h-4 text-accent" />
            <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
              Media Balance
            </p>
          </div>
          {mediaCredits.length > 0 ? (
            <ul className="space-y-1.5">
              {mediaCredits.map((c) => (
                <li key={c.credit_kind} className="flex items-center justify-between font-mono text-sm">
                  <span className="text-black/70">{c.label}</span>
                  <span className="font-bold">{c.remaining}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-xs text-black/50">
              No media credits yet. Buy a package or item below to load your balance.
            </p>
          )}
        </div>

        {/* Studio hours (gift card) */}
        <div className="border-2 border-black/10 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-4 h-4 text-accent" />
            <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
              Studio Hours
            </p>
          </div>
          {studioHours.hoursRemaining > 0 ? (
            <>
              <p className="font-mono text-3xl font-bold mb-1">{studioHours.hoursRemaining.toFixed(1)} hrs</p>
              <p className="font-mono text-xs text-black/60 mb-3">
                Prepaid studio time.{' '}
                {studioHours.costBasisCents > 0 && <>Value: {formatCents(studioHours.costBasisCents)}.</>}
              </p>
              <Link
                href="/dashboard/media/credits"
                className="font-mono text-[11px] font-bold uppercase tracking-wider text-accent hover:underline inline-flex items-center gap-1 no-underline"
              >
                Book studio time <ArrowRight className="w-3 h-3" />
              </Link>
            </>
          ) : (
            <p className="font-mono text-3xl font-bold text-black/20">0 hrs</p>
          )}
        </div>

        {/* Orders entry point */}
        <Link
          href="/dashboard/media/orders"
          className="border-2 border-accent bg-accent/5 p-5 hover:bg-accent/10 transition-colors no-underline flex flex-col justify-between"
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-accent" />
            <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
              Your Orders {orderCount > 0 && <>· {orderCount}</>}
            </p>
          </div>
          <p className="font-mono text-[11px] text-black/60 mt-2">
            {orderCount > 0
              ? 'Schedule sessions and view deliverables.'
              : 'When you buy, your orders + sessions land here.'}
          </p>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-accent inline-flex items-center gap-1 mt-3">
            Open <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      </div>

      {/* Catalog — the existing cart-pattern client component, inline. */}
      {packages.length > 0 || services.length > 0 ? (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8">
          <MediaCatalogClient
            packages={packages}
            services={services}
            profilePhone={profilePhone}
            isAdmin={isAdmin}
          />
        </div>
      ) : (
        <p className="font-mono text-sm text-black/60 border-2 border-black/10 p-8 text-center">
          No offerings available right now. Check back soon, or{' '}
          <Link href="/contact" className="text-accent hover:underline">reach out</Link> with something specific.
        </p>
      )}
    </div>
  );
}
