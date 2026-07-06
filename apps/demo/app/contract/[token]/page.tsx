// app/contract/[token]/page.tsx
//
// PUBLIC, NO-LOGIN contract surface (DocuSign-style).
//
// A customer who was emailed a contract clicks /contract/<token> and can read
// the FULL contract, sign, and pay WITHOUT logging in. This fixes the original
// bug: the email pointed at the account-bound order page, which 404'd / walled
// brand-new customers (who have no account) at login.
//
// SECURITY — this is a public, unauthenticated page that signs a contract and
// takes money:
//   * The booking is resolved SOLELY by public_token via the service client.
//     No booking id is ever read from the URL/client — only the token. A token
//     therefore grants access to exactly ONE contract and nothing else.
//   * On a missing/invalid token we render a clean notFound() (404) — we never
//     confirm whether a token exists.
//   * We load and render ONLY what this one contract needs (its own terms,
//     signatures, shoots, installments, total, deliverables, offering title,
//     buyer display name). No other booking's data and no extra PII.
//   * is_test bookings render but the token pay route refuses real payment.
//
// There is NO auth gate here by design — the token IS the credential.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getInstallmentsForBooking } from '@/lib/media-installments-server';
import { getSessionsForBooking } from '@/lib/media-scheduling-server';
import type { LineItem } from '@/lib/media-packages';
import MediaContractSchedule from '@/components/media/MediaContractSchedule';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Contract — Sweet Dreams US LLC',
  // No-login public credential page — keep it out of search engines.
  robots: { index: false, follow: false },
};

export default async function PublicContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // A too-short / empty token can never be valid — 404 without querying.
  if (!token || token.length < 32) notFound();

  const service = createServiceClient();

  // ── Resolve the booking by TOKEN ONLY ──────────────────────────────
  // Never by a client-supplied id. Select only the fields the contract needs.
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select(
      [
        'id',
        'user_id',
        'offering_id',
        'contract_terms',
        'contract_agreed_at',
        'manager_agreed_at',
        'project_details',
        'final_price_cents',
        'is_test',
      ].join(', '),
    )
    .eq('public_token', token)
    .maybeSingle();
  if (!bookingRow) notFound();

  const booking = bookingRow as unknown as {
    id: string;
    user_id: string | null;
    offering_id: string | null;
    contract_terms: string | null;
    contract_agreed_at: string | null;
    manager_agreed_at: string | null;
    project_details: {
      planned_shoots?: Array<{
        date: string;
        start_time: string;
        duration_hours: number;
        location: 'studio' | 'external';
        external_location_text?: string | null;
        engineer_name?: string | null;
        session_kind?: string | null;
      }>;
      contract_finalized_at?: string | null;
    } | null;
    final_price_cents: number;
    is_test: boolean | null;
  };

  // ── Server-load everything the contract needs (by the RESOLVED id) ──
  // Offering title, buyer display name (for the header), installments, line
  // items, and whether real calendar sessions exist. All keyed off the
  // token-resolved booking id — never anything from the client.
  const [offeringRes, buyerRes, installments, sessions] = await Promise.all([
    booking.offering_id
      ? service
          .from('media_offerings')
          .select('title')
          .eq('id', booking.offering_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    booking.user_id
      ? service
          .from('profiles')
          .select('display_name')
          .eq('user_id', booking.user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getInstallmentsForBooking(booking.id, service),
    getSessionsForBooking(booking.id, service),
  ]);

  const offeringTitle =
    (offeringRes.data as { title?: string | null } | null)?.title ||
    'Your media project';
  const buyerName =
    (buyerRes.data as { display_name?: string | null } | null)?.display_name ||
    null;

  // Package line items — resolved server-side by the booking id (the public
  // pay/agree flow has no session, so the client can't fetch the session-auth
  // /package endpoint). Passed to MediaContractSchedule as lineItemsOverride.
  let lineItems: LineItem[] = [];
  const { data: pkgRow } = await service
    .from('media_booking_packages')
    .select('id')
    .eq('booking_id', booking.id)
    .maybeSingle();
  if (pkgRow) {
    const { data: items } = await service
      .from('media_booking_line_items')
      .select('*')
      .eq('package_id', (pkgRow as { id: string }).id)
      .order('sort_order', { ascending: true });
    lineItems = (items ?? []) as LineItem[];
  }

  const activeSessions = sessions.filter((s) => s.status !== 'cancelled');

  const plannedShoots = (booking.project_details?.planned_shoots ?? []).map(
    (s) => ({
      date: s.date,
      start_time: s.start_time,
      duration_hours: s.duration_hours,
      location: s.location,
      external_location_text: s.external_location_text ?? null,
      engineer_name: s.engineer_name ?? null,
      session_kind: s.session_kind ?? null,
    }),
  );

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Header — branded, no dashboard nav (public, no session). */}
      <section className="bg-black text-white py-10 border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs font-semibold tracking-[0.3em] uppercase mb-2">
            Sweet Dreams US LLC · Contract
            {booking.is_test && (
              <span className="ml-2 px-2 py-0.5 bg-purple-700 text-white text-[10px] font-bold tracking-wider">
                TEST
              </span>
            )}
          </p>
          <h1 className="text-heading-xl mb-2">Your Sweet Dreams US LLC contract</h1>
          <p className="font-mono text-sm text-white/60">
            {buyerName ? `${buyerName} · ` : ''}
            {offeringTitle}
          </p>
          <p className="font-mono text-[11px] text-white/40 mt-3 max-w-2xl">
            Read the full contract below, add your signature, and — once both
            parties have signed — pay your balance. No login required; this
            secure link is unique to your contract.
          </p>
        </div>
      </section>

      {/* The full contract — terms, shoot, all deliverables, total,
          signatures, and the pay box — in PUBLIC/token mode. */}
      <section className="bg-white text-black py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <MediaContractSchedule
            bookingId={booking.id}
            contractTerms={booking.contract_terms}
            contractAgreedAt={booking.contract_agreed_at}
            managerAgreedAt={booking.manager_agreed_at}
            contractFinalizedAt={
              booking.project_details?.contract_finalized_at ?? null
            }
            plannedShoots={plannedShoots}
            installments={installments.map((i) => ({
              id: i.id,
              sort_order: i.sort_order,
              label: i.label,
              amount_cents: i.amount_cents,
              due_date: i.due_date,
              status: i.status,
              stripe_payment_link_url: i.stripe_payment_link_url,
              paid_at: i.paid_at,
              paid_method: i.paid_method,
            }))}
            totalCents={booking.final_price_cents}
            isTest={!!booking.is_test}
            hasScheduledSessions={activeSessions.length > 0}
            publicToken={token}
            lineItemsOverride={lineItems}
          />
        </div>
      </section>

      <footer className="bg-black text-white/40 py-8 text-center">
        <p className="font-mono text-[11px]">
          Sweet Dreams US LLC · This contract link is private to you.
        </p>
      </footer>
    </main>
  );
}
