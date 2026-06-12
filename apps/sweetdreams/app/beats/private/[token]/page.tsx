'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, Download, FileText, Music, AlertCircle } from 'lucide-react';

type SaleData = {
  id: string;
  beat_title: string;
  beat_cover_url: string | null;
  producer_name: string;
  license_type: string;
  license_text: string;
  amount: number;
  requires_payment: boolean;
  buyer_name: string;
  buyer_email: string;
  status: 'pending' | 'signed' | 'paid' | 'completed' | 'expired';
  download_files: { name: string; url: string }[];
};

type PageState = 'loading' | 'not_found' | 'review' | 'agreement' | 'signing' | 'payment' | 'completed';

export default function PrivateBeatSalePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const justPaid = searchParams.get('paid') === 'true';

  const [state, setState] = useState<PageState>('loading');
  const [sale, setSale] = useState<SaleData | null>(null);
  const [error, setError] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [buyerNameConfirm, setBuyerNameConfirm] = useState('');

  const loadSale = useCallback(async () => {
    try {
      const res = await fetch(`/api/beats/private-sale/${token}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid or expired link.');
        setState('not_found');
        return null;
      }

      setSale(data.sale);

      if (data.sale.status === 'completed' || data.sale.status === 'paid') {
        setState('completed');
        return 'completed';
      }

      if (data.sale.status === 'signed' && data.sale.requires_payment) {
        setState('payment');
        return 'payment';
      }

      if (state === 'loading') {
        setState('review');
      }

      return data.sale.status;
    } catch {
      setError('Failed to load sale details.');
      setState('not_found');
      return null;
    }
  }, [token, state]);

  useEffect(() => {
    loadSale();
  }, [loadSale]);

  // Poll for completion after Stripe redirect
  useEffect(() => {
    if (!justPaid || state === 'completed') return;

    setState('payment');
    let attempts = 0;
    const maxAttempts = 20;

    const interval = setInterval(async () => {
      attempts++;
      const status = await loadSale();

      if (status === 'completed' || attempts >= maxAttempts) {
        clearInterval(interval);
        if (attempts >= maxAttempts && status !== 'completed') {
          setState('completed');
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [justPaid, state, loadSale]);

  async function handleSign() {
    if (!sale || !agreedToTerms || !buyerNameConfirm.trim()) return;
    setState('signing');

    try {
      const res = await fetch(`/api/beats/private-sale/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerNameConfirm: buyerNameConfirm.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          // Redirect to login, then back here
          window.location.href = `/login?redirect=/beats/private/${token}`;
          return;
        }
        setError(data.error || 'Failed to sign agreement.');
        setState('agreement');
        return;
      }

      if (sale.requires_payment) {
        // Redirect to Stripe checkout
        setState('payment');
        const checkoutRes = await fetch(`/api/beats/private-sale/${token}/checkout`, {
          method: 'POST',
        });
        const checkoutData = await checkoutRes.json();

        if (checkoutData.url) {
          window.location.href = checkoutData.url;
        } else {
          setError(checkoutData.error || 'Failed to start payment.');
          setState('agreement');
        }
      } else {
        // No payment required — go straight to completed
        await loadSale();
        setState('completed');
      }
    } catch {
      setError('Something went wrong.');
      setState('agreement');
    }
  }

  function formatCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-accent" />
          <p className="font-mono text-sm text-white/80">Loading sale details...</p>
        </div>
      </div>
    );
  }

  // ── Not Found ────────────────────────────────────────────────────────
  if (state === 'not_found') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="font-mono text-xl font-bold text-white uppercase tracking-wider mb-4">
            NOT FOUND
          </h1>
          <p className="font-mono text-sm text-white/80 mb-6">{error}</p>
          <a href="/beats" className="font-mono text-sm text-accent hover:underline">
            Browse beats &rarr;
          </a>
        </div>
      </div>
    );
  }

  if (!sale) return null;

  // ── Completed ────────────────────────────────────────────────────────
  if (state === 'completed') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4 py-12">
        <div className="max-w-lg w-full">
          <div className="border border-white/10 p-8">
            <div className="text-center mb-8">
              <CheckCircle className="w-12 h-12 text-accent mx-auto mb-4" />
              <h1 className="font-mono text-2xl font-bold text-accent uppercase tracking-wider mb-2">
                PURCHASE COMPLETE
              </h1>
              <p className="font-mono text-sm text-white/80">
                Your beat purchase is complete. Download your files below.
              </p>
            </div>

            {/* Beat info */}
            <div className="border-t border-white/10 pt-6 mb-6">
              <div className="flex gap-4 items-start">
                {sale.beat_cover_url && (
                  <img
                    src={sale.beat_cover_url}
                    alt={sale.beat_title}
                    className="w-20 h-20 object-cover border border-white/10 shrink-0"
                  />
                )}
                <div className="font-mono text-sm space-y-1">
                  <p className="text-white font-bold">{sale.beat_title}</p>
                  <p className="text-white/80">Produced by {sale.producer_name}</p>
                  <p className="text-white/80">{sale.license_type} License</p>
                  {sale.amount > 0 && (
                    <p className="text-accent font-bold">{formatCents(sale.amount)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Download files */}
            {sale.download_files && sale.download_files.length > 0 && (
              <div className="space-y-3 mb-6">
                <p className="font-mono text-xs text-white/60 uppercase tracking-wider">
                  Your Files
                </p>
                {sale.download_files.map((file, i) => (
                  <a
                    key={i}
                    href={file.url}
                    download
                    className="flex items-center gap-3 bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-4 hover:bg-accent/90 transition-colors no-underline"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    {file.name}
                  </a>
                ))}
              </div>
            )}

            {/* License text */}
            <div className="border-t border-white/10 pt-6">
              <button
                onClick={() => {
                  const el = document.getElementById('license-completed');
                  if (el) el.classList.toggle('hidden');
                }}
                className="flex items-center gap-2 font-mono text-xs text-white/60 uppercase tracking-wider hover:text-white/60 transition-colors mb-3"
              >
                <FileText className="w-3 h-3" />
                View License Agreement
              </button>
              <div
                id="license-completed"
                className="hidden border border-white/10 p-4 max-h-60 overflow-y-auto font-mono text-xs text-white/60 whitespace-pre-wrap"
              >
                {sale.license_text}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Payment (processing) ─────────────────────────────────────────────
  if (state === 'payment') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="max-w-lg w-full">
          <div className="border border-white/10 p-8 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto mb-4" />
            <h1 className="font-mono text-xl font-bold text-white uppercase tracking-wider mb-2">
              {justPaid ? 'CONFIRMING PAYMENT' : 'REDIRECTING TO PAYMENT'}
            </h1>
            <p className="font-mono text-sm text-white/80">
              {justPaid
                ? 'Payment received! Finalizing your purchase...'
                : 'Please wait while we redirect you to checkout...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Signing (loading) ────────────────────────────────────────────────
  if (state === 'signing') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="max-w-lg w-full">
          <div className="border border-white/10 p-8 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto mb-4" />
            <h1 className="font-mono text-xl font-bold text-white uppercase tracking-wider mb-2">
              PROCESSING
            </h1>
            <p className="font-mono text-sm text-white/80">
              Signing your agreement...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Agreement ────────────────────────────────────────────────────────
  if (state === 'agreement') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4 py-12">
        <div className="max-w-lg w-full">
          <div className="border border-white/10 p-8">
            <h1 className="font-mono text-2xl font-bold text-accent uppercase tracking-wider mb-2">
              LICENSE AGREEMENT
            </h1>
            <p className="font-mono text-sm text-white/80 mb-6">
              Read the full license agreement below. You must agree to the terms and confirm your name to proceed.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 px-4 py-3 mb-6">
                <p className="font-mono text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* License text */}
            <div className="border border-white/10 p-4 max-h-72 overflow-y-auto font-mono text-xs text-white/60 whitespace-pre-wrap mb-6">
              {sale.license_text}
            </div>

            {/* Agreement checkbox */}
            <label className="flex items-start gap-3 mb-4 cursor-pointer group">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#F4C430] shrink-0"
              />
              <span className="font-mono text-sm text-white/70 group-hover:text-white/90 transition-colors">
                I have read and agree to the terms of this license agreement
              </span>
            </label>

            {/* Buyer name confirmation */}
            <div className="mb-6">
              <label className="block font-mono text-xs text-white/60 uppercase tracking-wider mb-2">
                Type your full name to sign
              </label>
              <input
                type="text"
                value={buyerNameConfirm}
                onChange={(e) => setBuyerNameConfirm(e.target.value)}
                placeholder={sale.buyer_name}
                className="w-full bg-white/5 border border-white/10 px-4 py-3 font-mono text-sm text-white placeholder:text-white/20 focus:border-accent focus:outline-none transition-colors"
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setError('');
                  setState('review');
                }}
                className="px-6 py-3 border border-white/20 font-mono text-sm text-white/60 uppercase tracking-wider hover:border-white/40 hover:text-white transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSign}
                disabled={!agreedToTerms || !buyerNameConfirm.trim()}
                className="flex-1 bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider py-3 hover:bg-accent/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {sale.requires_payment ? 'SIGN & PAY' : 'SIGN & DOWNLOAD'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Review (default) ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="border border-white/10 p-8">
          <h1 className="font-mono text-2xl font-bold text-accent uppercase tracking-wider mb-2">
            PRIVATE BEAT SALE
          </h1>
          <p className="font-mono text-sm text-white/80 mb-6">
            {sale.producer_name} has set up a private sale for you. Review the details below.
          </p>

          {/* Beat info */}
          <div className="mb-6">
            <div className="flex gap-4 items-start">
              {sale.beat_cover_url ? (
                <img
                  src={sale.beat_cover_url}
                  alt={sale.beat_title}
                  className="w-24 h-24 object-cover border border-white/10 shrink-0"
                />
              ) : (
                <div className="w-24 h-24 bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <Music className="w-8 h-8 text-white/20" />
                </div>
              )}
              <div className="font-mono text-sm space-y-2 pt-1">
                <p className="text-white font-bold text-base">{sale.beat_title}</p>
                <p className="text-white/80">Produced by {sale.producer_name}</p>
              </div>
            </div>
          </div>

          {/* Sale details */}
          <div className="border-t border-b border-white/10 py-4 mb-6 font-mono text-sm space-y-3">
            <div className="flex justify-between">
              <span className="text-white/60 uppercase tracking-wider text-xs">License</span>
              <span className="text-white font-bold">{sale.license_type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60 uppercase tracking-wider text-xs">Price</span>
              <span className="text-accent font-bold text-lg">
                {sale.requires_payment ? formatCents(sale.amount) : 'No Charge'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60 uppercase tracking-wider text-xs">Buyer</span>
              <span className="text-white/70">{sale.buyer_name}</span>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={() => {
              setError('');
              setState('agreement');
            }}
            className="w-full bg-accent text-black font-mono text-base font-bold uppercase tracking-wider py-4 hover:bg-accent/90 transition-colors"
          >
            CONTINUE TO AGREEMENT
          </button>

          <p className="font-mono text-[10px] text-white/60 text-center mt-4">
            You will review and sign the license agreement on the next step.
            {sale.requires_payment && ' Payment is processed securely via Stripe.'}
          </p>
        </div>
      </div>
    </div>
  );
}
