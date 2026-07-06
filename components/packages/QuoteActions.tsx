'use client';

// components/packages/QuoteActions.tsx
//
// Client island sitting at the bottom of /quotes/[token]/page.tsx.
// Owns the Accept / Decline buttons and their flows.
//
// Round C: accept transitions status only — no payment yet (Round D).
// Decline can be done by anyone with the token; accept requires the
// logged-in user to match the quote's recipient.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, X, AlertCircle } from 'lucide-react';
import { trackMeta, centsToDollars } from '@/lib/meta-pixel';

interface Props {
  token: string;
  /** Optional quote/template data for Meta Pixel InitiateCheckout (fire-and-forget). */
  totalPriceCents?: number;
  templateName?: string;
  isMembership?: boolean;
}

export default function QuoteActions({
  token,
  totalPriceCents,
  templateName,
  isMembership,
}: Props) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  async function accept() {
    setError(null);
    setAccepting(true);
    try {
      const res = await fetch(`/api/quotes/${token}/accept`, { method: 'POST' });
      if (res.status === 401) {
        // Not logged in — bounce them to login then back here.
        setNeedsLogin(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Accept failed.');
        return;
      }
      // Round D: server returns a Stripe Checkout URL. Redirect to it.
      // The actual quote status flip + entitlement mint happens in the
      // Stripe webhook on payment success — when we land back at
      // /quotes/[token]?status=success, the page reloads and shows
      // the "accepted" banner.
      if (body?.checkout_url) {
        // Meta Pixel: starting a paid package/membership checkout. Fire-and-forget
        // immediately before the redirect; never await, never block navigation.
        trackMeta('InitiateCheckout', {
          value: centsToDollars(totalPriceCents),
          currency: 'USD',
          content_name: templateName,
          content_category: isMembership ? 'membership_subscription' : 'package',
        });
        window.location.href = body.checkout_url as string;
        return;
      }
      // Backwards-compat: if some older accept path still returns ok
      // without a URL (shouldn't happen post-Round-D), refresh.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setAccepting(false);
    }
  }

  async function decline() {
    setError(null);
    setDeclining(true);
    try {
      const res = await fetch(`/api/quotes/${token}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Decline failed.');
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setDeclining(false);
      setShowDeclineModal(false);
    }
  }

  if (needsLogin) {
    const here = encodeURIComponent(`/quotes/${token}`);
    return (
      <div className="border-2 border-black p-6 space-y-4">
        <div className="inline-flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-accent" />
          <p className="font-mono text-sm">
            <strong>Sign in to accept.</strong>
          </p>
        </div>
        <p className="font-mono text-xs text-black/65">
          We need to confirm your identity to mint the entitlement to your account. If you don't
          have one yet, sign up — the quote stays valid.
        </p>
        <div className="flex gap-2 flex-wrap">
          <a
            href={`/login?redirect=${here}`}
            className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 hover:bg-black/80 transition-colors no-underline inline-flex items-center gap-2"
          >
            Sign In
          </a>
          <a
            href={`/login?mode=signup&redirect=${here}`}
            className="border border-black/30 font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 hover:border-black no-underline inline-flex items-center gap-2"
          >
            Create Account
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={accept}
          disabled={accepting || declining}
          className="bg-black text-white font-mono text-sm font-bold uppercase tracking-wider px-6 py-4 hover:bg-black/80 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
        >
          {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {accepting ? 'Redirecting to checkout…' : 'Accept & Pay'}
        </button>
        <button
          onClick={() => setShowDeclineModal(true)}
          disabled={accepting || declining}
          className="border border-black/30 font-mono text-sm font-bold uppercase tracking-wider px-6 py-4 hover:border-black transition-colors disabled:opacity-50"
        >
          Decline
        </button>
      </div>

      {error && (
        <p className="font-mono text-xs text-red-700 mt-3">{error}</p>
      )}

      {/* Decline modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white text-black w-full max-w-md border-2 border-black">
            <div className="border-b-2 border-black px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold">Decline this quote?</h3>
              <button
                onClick={() => setShowDeclineModal(false)}
                className="text-black/40 hover:text-black"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="font-mono text-xs text-black/65">
                Optional — let Sweet Dreams know why so they can refine the next offer. Or just
                hit decline.
              </p>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={3}
                placeholder="Pricing, timing, scope — anything helps."
                maxLength={500}
                className="w-full border-2 border-black px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none resize-y"
              />
            </div>
            <div className="border-t border-black/10 px-5 py-3 flex justify-end gap-2">
              <button
                onClick={() => setShowDeclineModal(false)}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border border-black/20 hover:border-black"
              >
                Back
              </button>
              <button
                onClick={decline}
                disabled={declining}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
              >
                {declining ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {declining ? 'Declining…' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
