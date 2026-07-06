import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import BeatSuccessClient from '@/components/beats/BeatSuccessClient';
import MetaTrack from '@/components/analytics/MetaTrack';
import { stripe } from '@/lib/stripe';
import { centsToDollars, type MetaEventParams } from '@/lib/meta-pixel';

export const metadata: Metadata = {
  title: 'Purchase Complete',
};

// Reads the amount actually charged in this Stripe Checkout so the Meta Purchase
// event carries a real dollar value for ROAS. Tamper-proof (server retrieve) and
// best-effort — if it fails, Purchase still fires without a value.
async function paidAmountUsd(sessionId: string | undefined): Promise<number | undefined> {
  if (!sessionId) return undefined;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (typeof session.amount_total === 'number' && session.amount_total > 0) {
      return centsToDollars(session.amount_total);
    }
  } catch {
    /* ignore — Purchase fires without value */
  }
  return undefined;
}

export default async function BeatSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const value = await paidAmountUsd(session_id);
  const purchaseParams: MetaEventParams = {
    content_name: 'Beat license',
    content_type: 'product',
    currency: 'USD',
    ...(value !== undefined ? { value } : {}),
  };
  return (
    <>
      {/* Purchase conversion fires once on confirmation-page mount, carrying the
          real amount charged (read from the Stripe session, tamper-proof). */}
      <MetaTrack event="Purchase" params={purchaseParams} />
      <section className="bg-black text-white py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <CheckCircle className="w-16 h-16 text-accent mx-auto mb-6" strokeWidth={1} />
          <h1 className="text-display-md mb-4">PURCHASE COMPLETE</h1>
          <p className="font-mono text-white/60 text-body-sm">
            Your beat license is ready. Download your files below.
          </p>
        </div>
      </section>

      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Suspense fallback={
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 text-accent mx-auto animate-spin" />
            </div>
          }>
            <BeatSuccessClient />
          </Suspense>
        </div>
      </section>
    </>
  );
}
