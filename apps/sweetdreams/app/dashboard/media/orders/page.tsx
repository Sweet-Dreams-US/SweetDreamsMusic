// app/dashboard/media/orders/page.tsx
//
// Orders list — every paid (and inquiry) media order belonging to the
// current user, including ones attached to bands they're a member of.
// Each row links to the order detail page where they can schedule
// sessions and see deliverables.
//
// Phase D MVP: this is the gateway from "I bought it" → "now schedule the
// shoot." Until Phase E lands a calendar grid view, this list IS the
// scheduling entry point.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Calendar, Clock, ArrowRight, Inbox } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getUserBands } from '@/lib/bands-server';
import { createServiceClient } from '@/lib/supabase/server';
import { getMediaBookingsForOwner } from '@/lib/media-scheduling-server';
import { formatCents } from '@/lib/utils';
import { fmtStampDate } from '@/lib/studio-time';
import DashboardNav from '@/components/layout/DashboardNav';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Media Orders — Sweet Dreams',
};

const STATUS_LABELS: Record<string, string> = {
  inquiry: 'Inquiry',
  deposited: 'Paid · Awaiting schedule',
  scheduled: 'Scheduled',
  in_production: 'In production',
  delivered: 'Delivered',
};

const STATUS_BADGE: Record<string, string> = {
  inquiry: 'bg-black/10 text-black/70',
  deposited: 'bg-accent/20 text-black',
  scheduled: 'bg-blue-100 text-blue-900',
  in_production: 'bg-purple-100 text-purple-900',
  delivered: 'bg-green-100 text-green-900',
};

export default async function MediaOrdersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?redirect=/dashboard/media/orders');

  const bandMemberships = await getUserBands(user.id);
  const bandIds = bandMemberships.map((m) => m.band_id);
  const bookings = await getMediaBookingsForOwner({
    userId: user.id,
    bandIds,
  });

  // Pre-fetch offering titles in one query — denormalizing here is
  // cheaper than N+1 reads and keeps the list page snappy.
  const offeringIds = Array.from(new Set(bookings.map((b) => b.offering_id)));
  const titleMap = new Map<string, string>();
  if (offeringIds.length > 0) {
    const service = createServiceClient();
    const { data: offerings } = await service
      .from('media_offerings')
      .select('id, title')
      .in('id', offeringIds);
    for (const o of (offerings || []) as { id: string; title: string }[]) {
      titleMap.set(o.id, o.title);
    }
  }

  // Map band_id → display_name for the "for X band" attribution badge.
  const bandNameMap = new Map<string, string>();
  for (const m of bandMemberships) bandNameMap.set(m.band_id, m.band.display_name);

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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-black/50 mb-2">
                Your media orders
              </p>
              <h1 className="text-heading-xl">ORDERS &amp; SESSIONS</h1>
            </div>
            <Link
              href="/dashboard/media"
              className="font-mono text-xs uppercase tracking-wider text-black/60 hover:text-black no-underline"
            >
              ← Back to catalog
            </Link>
          </div>

          {bookings.length === 0 ? (
            <div className="border-2 border-dashed border-black/10 p-10 text-center">
              <Inbox className="w-10 h-10 text-black/30 mx-auto mb-4" />
              <p className="font-mono text-sm text-black/60 mb-2">
                No media orders yet.
              </p>
              <p className="text-sm text-black/50 mb-6">
                Browse the catalog to grab a package or a single service.
              </p>
              <Link
                href="/dashboard/media"
                className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent hover:text-black transition-colors no-underline"
              >
                Open catalog
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {bookings.map((b) => {
                const title = titleMap.get(b.offering_id) || 'Media order';
                const bandLabel = b.band_id ? bandNameMap.get(b.band_id) : null;
                const statusKey = b.status as keyof typeof STATUS_LABELS;
                const statusLabel = STATUS_LABELS[statusKey] || b.status;
                const badgeCls = STATUS_BADGE[statusKey] || 'bg-black/10 text-black/70';
                return (
                  <li key={b.id}>
                    <Link
                      href={`/dashboard/media/orders/${b.id}`}
                      className="block border-2 border-black/10 hover:border-accent transition-colors p-5 no-underline text-black"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-lg font-bold truncate">{title}</h2>
                            {bandLabel && (
                              <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-black text-white">
                                {bandLabel}
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-xs text-black/50">
                            <Clock className="w-3 h-3 inline mr-1" />
                            Ordered {fmtStampDate(b.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                            {' · '}
                            {b.final_price_cents > 0
                              ? formatCents(b.final_price_cents)
                              : 'Inquiry — no commitment yet'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 ${badgeCls}`}
                          >
                            {statusLabel}
                          </span>
                          <Calendar className="w-4 h-4 text-black/40" />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
