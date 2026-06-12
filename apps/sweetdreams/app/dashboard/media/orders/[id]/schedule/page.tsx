// app/dashboard/media/orders/[id]/schedule/page.tsx
//
// Schedule a new media session for a specific order. Server shell loads
// the order + ownership check + offering kind hint, then renders the
// scheduler client component. The scheduler does the date/time pick,
// engineer dropdown, location/kind selectors, and posts to
// /api/media/sessions where conflicts are checked.

import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getUserBands } from '@/lib/bands-server';
import { createServiceClient } from '@/lib/supabase/server';
import { ENGINEERS } from '@/lib/constants';
import DashboardNav from '@/components/layout/DashboardNav';
import MediaSessionScheduler from '@/components/media/MediaSessionScheduler';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Schedule Session — Sweet Dreams Media',
};

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/dashboard/media/orders/${id}/schedule`);

  const service = createServiceClient();
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('id, user_id, band_id, status, offering_id')
    .eq('id', id)
    .maybeSingle();
  if (!bookingRow) notFound();
  const booking = bookingRow as {
    id: string;
    user_id: string;
    band_id: string | null;
    status: string;
    offering_id: string;
  };

  if (booking.user_id !== user.id) {
    if (!booking.band_id) notFound();
    const memberships = await getUserBands(user.id);
    if (!memberships.some((m) => m.band_id === booking.band_id)) notFound();
  }

  // Block scheduling for non-schedulable statuses. Send them back to the
  // detail page where the UI explains why.
  if (
    booking.status === 'inquiry' ||
    booking.status === 'cancelled' ||
    booking.status === 'delivered'
  ) {
    redirect(`/dashboard/media/orders/${id}`);
  }

  // Load the offering for context (title shown in the form header).
  const { data: offeringRow } = await service
    .from('media_offerings')
    .select('title, kind')
    .eq('id', booking.offering_id)
    .maybeSingle();
  const offering = offeringRow as { title: string; kind: string } | null;

  // Engineer roster — read-only constant for the dropdown. We pass display
  // name as the form value; server resolves to user_id via the email.
  const engineers = ENGINEERS.map((e) => ({
    name: e.name,
    displayName: e.displayName,
    specialties: [...e.specialties],
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            href={`/dashboard/media/orders/${id}`}
            className="font-mono text-xs text-black/60 hover:text-black no-underline inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to order
          </Link>

          <p className="font-mono text-xs uppercase tracking-wider text-black/50 mb-2">
            Schedule a session
          </p>
          <h1 className="text-heading-xl mb-3">
            {offering?.title || 'Your media order'}
          </h1>
          <p className="font-mono text-sm text-black/60 mb-8">
            Pick a date, engineer, and location. We check conflicts against the
            studio calendar AND existing media work — you&apos;ll get a clear error
            if the slot&apos;s already taken.
          </p>

          <MediaSessionScheduler
            parentBookingId={id}
            engineers={engineers}
          />
        </div>
      </section>
    </>
  );
}
