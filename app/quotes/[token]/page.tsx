// app/quotes/[token]/page.tsx
//
// Public quote viewer. No login required to view (token-based, like
// band invites and event RSVPs). Accept requires login + matching
// recipient identity; decline is anonymous-friendly.
//
// Server component fetches the quote from /api/quotes/[token] and
// renders price + lines + status. The Accept/Decline buttons are in
// a client island (QuoteActions) so the bulk of the page stays
// server-rendered.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { Crown, Users, Clock, Film, Music, Package, Calendar, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import QuoteActions from '@/components/packages/QuoteActions';
import { fmtStampDate } from '@/lib/studio-time';

interface QuoteLine {
  id: string;
  kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  quantity: number;
  full_price_cents: number;
  package_value_cents: number;
  notes: string | null;
}

interface Quote {
  id: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  total_price_cents: number;
  total_full_price_cents: number;
  total_discount_cents: number;
  customer_message: string | null;
  expires_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  band_id: string | null;
  band_name: string | null;
}

interface Template {
  name: string;
  description: string | null;
  audience: 'solo' | 'band';
  is_membership: boolean;
  membership_months: number | null;
  duration_days: number | null;
  price_cents: number;
}

export const metadata: Metadata = {
  title: 'Quote — Sweet Dreams Music',
  robots: { index: false, follow: false },
};

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function lineLabel(line: QuoteLine): string {
  switch (line.kind) {
    case 'studio_hours': return `${line.quantity} studio hour${line.quantity === 1 ? '' : 's'}`;
    case 'media_offering': return line.notes || `Media offering × ${line.quantity}`;
    case 'beat_credit': return `${line.quantity} beat credit${line.quantity === 1 ? '' : 's'}`;
    case 'custom': return line.notes || `Custom × ${line.quantity}`;
  }
}

function lineIcon(kind: QuoteLine['kind']) {
  switch (kind) {
    case 'studio_hours': return Clock;
    case 'media_offering': return Film;
    case 'beat_credit': return Music;
    case 'custom': return Package;
  }
}

async function fetchQuote(token: string): Promise<{ quote: Quote; template: Template; lines: QuoteLine[] } | null> {
  // Use absolute URL — server components run on the server and need the
  // origin. Pulling from the request headers avoids hardcoding env-specific
  // URLs.
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host');
  if (!host) return null;
  const origin = `${proto}://${host}`;

  const res = await fetch(`${origin}/api/quotes/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await fetchQuote(token);
  if (!data) notFound();

  const { quote, template, lines } = data;
  const isExpired = quote.status === 'expired'
    || (quote.expires_at && new Date(quote.expires_at) < new Date());
  const grossRevenue = template.is_membership
    ? template.price_cents * (template.membership_months ?? 0)
    : template.price_cents;
  const discountPct = quote.total_full_price_cents > 0
    ? Math.round((quote.total_discount_cents / quote.total_full_price_cents) * 100)
    : 0;

  return (
    <section className="bg-white text-black min-h-[80vh]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {/* Status banner — only when accepted/declined/expired */}
        {quote.status === 'accepted' && (
          <div className="border-2 border-green-600 bg-green-50 p-4 mb-8 inline-flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-700" />
            <p className="font-mono text-sm text-green-900">
              <strong>Accepted.</strong> Sweet Dreams will reach out to confirm payment + next steps.
            </p>
          </div>
        )}
        {quote.status === 'declined' && (
          <div className="border-2 border-black/30 bg-black/[0.03] p-4 mb-8 inline-flex items-center gap-2">
            <XCircle className="w-5 h-5 text-black/60" />
            <p className="font-mono text-sm text-black/70">
              <strong>Declined.</strong> No worries — feel free to reach out if anything changes.
            </p>
          </div>
        )}
        {isExpired && quote.status !== 'accepted' && quote.status !== 'declined' && (
          <div className="border-2 border-orange-400 bg-orange-50 p-4 mb-8 inline-flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-700" />
            <p className="font-mono text-sm text-orange-900">
              <strong>This quote has expired.</strong> Reach out to Sweet Dreams for a fresh one.
            </p>
          </div>
        )}

        {/* Header */}
        <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
          Sweet Dreams · Quote
        </p>
        <h1 className="text-heading-xl mb-2">{template.name.toUpperCase()}</h1>
        {template.description && (
          <p className="font-mono text-sm text-black/65 mb-4 max-w-2xl">{template.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-8">
          {template.is_membership && (
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 bg-accent text-black font-bold inline-flex items-center gap-1">
              <Crown className="w-3 h-3" />
              {template.membership_months}-Month Membership
            </span>
          )}
          {!template.is_membership && (
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-black/30 font-bold inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              One-Time · {template.duration_days}-day window
            </span>
          )}
          {template.audience === 'band' && quote.band_name && (
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-black/30 font-bold inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              For {quote.band_name}
            </span>
          )}
        </div>

        {/* Custom message */}
        {quote.customer_message && (
          <div className="border-l-4 border-accent bg-black/[0.02] px-5 py-4 mb-8">
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/55 mb-2">A note</p>
            <p className="font-mono text-sm text-black/80 whitespace-pre-wrap">{quote.customer_message}</p>
          </div>
        )}

        {/* Price block */}
        <div className="border-2 border-black p-6 mb-8">
          {template.is_membership ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Per month</p>
              <p className="text-4xl font-bold mb-1">{formatMoney(template.price_cents)}</p>
              <p className="font-mono text-xs text-black/65">
                × {template.membership_months} months · <strong>{formatMoney(grossRevenue)}</strong> total commitment
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Total</p>
              <p className="text-4xl font-bold mb-1">{formatMoney(quote.total_price_cents)}</p>
              {template.duration_days && (
                <p className="font-mono text-xs text-black/65">
                  Valid {template.duration_days} days from acceptance
                </p>
              )}
            </>
          )}
          {quote.total_discount_cents > 0 && (
            <p className="font-mono text-xs text-accent font-bold mt-3">
              {discountPct}% off retail · saving {formatMoney(quote.total_discount_cents)}
            </p>
          )}
        </div>

        {/* Lines */}
        <p className="font-mono text-[10px] uppercase tracking-wider text-black/55 mb-3">What's included</p>
        <ul className="border-2 border-black/15 divide-y divide-black/10 mb-8">
          {lines.map((line) => {
            const Icon = lineIcon(line.kind);
            return (
              <li key={line.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 text-black/45 shrink-0" />
                  <span className="font-mono text-sm">{lineLabel(line)}</span>
                </div>
                <span className="font-mono text-xs text-black/55 shrink-0">
                  Retail {formatMoney(line.full_price_cents)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Fine print */}
        <div className="bg-black/[0.02] p-4 mb-8 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/55">The fine print</p>
          <p className="font-mono text-xs text-black/70">
            • All studio session valuations are at Studio B rate. If you book Studio A, Sweet 4
            flat-rate, or a same-day session, surcharges are paid at the time of booking.
          </p>
          {template.is_membership && (
            <>
              <p className="font-mono text-xs text-black/70">
                • Memberships are full-commitment contracts. {template.membership_months} months,
                no cancellation, no refund. Cards are charged monthly via Stripe.
              </p>
              <p className="font-mono text-xs text-black/70">
                • Memberships do not auto-renew. At the end of {template.membership_months} months,
                we'll renegotiate a fresh package together.
              </p>
            </>
          )}
          <p className="font-mono text-xs text-black/70">
            • Need more inside the package? Use the &ldquo;Request more&rdquo; button in your dashboard
            after acceptance — admin handles add-ons at the same discounted rate.
          </p>
          {quote.expires_at && (
            <p className="font-mono text-xs text-black/70">
              • Quote expires <strong>{fmtStampDate(quote.expires_at, { weekday: 'long', month: 'long' })}</strong>.
            </p>
          )}
        </div>

        {/* Actions */}
        {quote.status === 'sent' && !isExpired && (
          <QuoteActions token={token} />
        )}
      </div>
    </section>
  );
}
