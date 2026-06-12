'use client';

// components/media/MediaCatalogClient.tsx
//
// Orchestrator for the new cart-pattern /dashboard/media. Owns:
//   - Cart provider (state lives here)
//   - "Which card is expanded" — single-expansion model so the page
//     doesn't get visually overwhelming with multiple panels open
//   - Renders package + à la carte sections
//   - Renders the cart sidebar / mobile bottom bar
//
// Server-side parent (/dashboard/media/page.tsx) hands us the offering
// arrays already pre-grouped + filtered by viewer eligibility.

import { useState } from 'react';
import { Package as PackageIcon, Sparkles } from 'lucide-react';
import type { MediaOffering } from '@/lib/media';
import { MediaCartProvider } from './MediaCartContext';
import PackageCard from './PackageCard';
import AlaCarteCard from './AlaCarteCard';
import MediaCartSidebar from './MediaCartSidebar';

export default function MediaCatalogClient({
  packages,
  services,
  profilePhone,
  isAdmin,
}: {
  packages: MediaOffering[];
  services: MediaOffering[];
  /** Phone on the buyer's profile, if set. If null/empty, the cart's
   *  Checkout button surfaces a phone input the buyer must fill before
   *  Stripe can be hit. We persist it to the profile after checkout so
   *  the prompt only fires once per account. */
  profilePhone?: string | null;
  /** When true, the cart sidebar shows a "Test mode (skip Stripe)" toggle.
   *  Test purchases write rows with is_test=true so they're excluded
   *  from accounting, and the Stripe call is replaced with a direct
   *  insert via /api/admin/media/test-checkout. */
  isAdmin?: boolean;
}) {
  // Single-expansion model: one card at a time. Closing a card by
  // clicking its header just sets `expandedId` to null.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <MediaCartProvider>
      <div className="lg:pr-[22rem]">
        {/* CATALOG — Studio Packages */}
        {packages.length > 0 && (
          <section className="bg-white text-black py-12 sm:py-16">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3 mb-3">
                <PackageIcon className="w-5 h-5 text-accent" />
                <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase text-black/50">
                  Studio Packages
                </p>
              </div>
              <h2 className="text-heading-xl mb-3">RECORD, ROLLOUT, GROW.</h2>
              <p className="font-mono text-body-sm text-black/70 max-w-2xl mb-8">
                Tap a package to see what&apos;s included. Build it out, fill the project
                details, and add to your cart — all on this page.
              </p>

              <ul className="space-y-3">
                {packages.map((pkg) => (
                  <PackageCard
                    key={pkg.id}
                    offering={pkg}
                    isExpanded={expandedId === pkg.id}
                    onToggle={() =>
                      setExpandedId(expandedId === pkg.id ? null : pkg.id)
                    }
                  />
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* CATALOG — À La Carte */}
        {services.length > 0 && (
          <section className="bg-black text-white py-12 sm:py-16">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3 mb-3">
                <Sparkles className="w-5 h-5 text-accent" />
                <p className="font-mono text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase text-white/60">
                  À La Carte
                </p>
              </div>
              <h2 className="text-heading-xl mb-3">EVERYTHING, INDIVIDUALLY</h2>
              <p className="font-mono text-body-sm text-white/70 max-w-2xl mb-8">
                Add as many pieces as you need. Each one carries its own project info
                so we know what we&apos;re shooting / making.
              </p>

              <ul className="space-y-2 bg-white text-black p-4 sm:p-5">
                {services.map((svc) => (
                  <AlaCarteCard
                    key={svc.id}
                    offering={svc}
                    isExpanded={expandedId === svc.id}
                    onToggle={() =>
                      setExpandedId(expandedId === svc.id ? null : svc.id)
                    }
                  />
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>

      <MediaCartSidebar profilePhone={profilePhone} isAdmin={isAdmin} />
    </MediaCartProvider>
  );
}
