'use client';

// components/media/MediaCartSidebar.tsx
//
// Two presentations of the same cart state:
//   • Desktop  — sticky right rail when cart has items
//   • Mobile   — fixed bottom bar with item count + open-drawer button;
//                tapping opens an overlay drawer with the full cart
//
// Round 6 additions:
//   - 50% DEPOSIT framing on the totals. Stripe charges half; remainder
//     billed by admin after they call the buyer to plan.
//   - Phone-at-checkout. If the buyer's profile already has a phone, we
//     pre-fill it (read-only summary). Otherwise an input gates the
//     Checkout button — the API requires phone for follow-up call.
//
// Posts to /api/media/checkout with the cart array + phone. API
// recomputes prices server-side (never trusts client computedPrice)
// and returns the Stripe URL we redirect to.

import { useState } from 'react';
import { ShoppingCart, X, Trash2, ArrowRight, Phone } from 'lucide-react';
import { useMediaCart } from './MediaCartContext';
import { toCheckoutPayload, type MediaCartItem } from '@/lib/media-cart';

function fmt(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function MediaCartSidebar({
  profilePhone,
  isAdmin,
}: {
  profilePhone?: string | null;
  isAdmin?: boolean;
}) {
  const cart = useMediaCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Phone state. Pre-fill from the profile when present so returning
  // buyers don't see the prompt; empty triggers the input UI.
  const [phone, setPhone] = useState(profilePhone ?? '');
  // Admin-only: skip Stripe and write rows with is_test=true. Lets us
  // test the full flow without polluting accounting.
  const [testMode, setTestMode] = useState(false);

  // Phone validation is intentionally permissive — we just require enough
  // digits to look like a real number. The team calls these manually so
  // a strict regex would just frustrate buyers entering "+1 (260) ..."
  // formats.
  const phoneClean = phone.replace(/\D/g, '');
  const phoneOk = phoneClean.length >= 7;

  async function checkout() {
    if (cart.items.length === 0) return;
    // Test mode skips phone validation — admin is just simulating.
    if (!testMode && !phoneOk) {
      setError('Phone number required so we can call to plan.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Test-mode admins go to the bypass endpoint that writes rows
      // with is_test=true; everyone else hits Stripe.
      const endpoint = testMode
        ? '/api/admin/media/test-checkout'
        : '/api/media/checkout';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: toCheckoutPayload(cart.items),
          phone: phone.trim() || null,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login?redirect=/dashboard/media';
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start checkout. Try again.');
        setSubmitting(false);
        return;
      }
      // Test mode returns { ok, success_url } — same redirect pattern,
      // no Stripe URL.
      if (data.url) {
        window.location.href = data.url;
      } else if (data.success_url) {
        window.location.href = data.success_url;
      } else {
        setError('Checkout URL missing — please try again.');
        setSubmitting(false);
      }
    } catch (e) {
      console.error('[media-cart] checkout error:', e);
      setError('Network error — try again.');
      setSubmitting(false);
    }
  }

  if (cart.items.length === 0) return null;

  return (
    <>
      {/* DESKTOP — sticky right rail. Hidden on small screens; the bottom
          bar takes over there. */}
      <aside className="hidden lg:block fixed right-4 top-32 w-80 max-h-[calc(100vh-9rem)] overflow-y-auto z-30 bg-white border-2 border-black shadow-lg">
        <CartContents
          items={cart.items}
          totalCents={cart.totalCents}
          onRemove={cart.removeItem}
          onCheckout={checkout}
          submitting={submitting}
          error={error}
          phone={phone}
          onPhoneChange={setPhone}
          phoneOk={phoneOk}
          phoneFromProfile={!!profilePhone}
          isAdmin={isAdmin}
          testMode={testMode}
          onTestModeChange={setTestMode}
        />
      </aside>

      {/* MOBILE — fixed bottom bar with item count, tap opens drawer */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed bottom-4 right-4 left-4 z-30 bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-4 inline-flex items-center justify-between shadow-lg"
        >
          <span className="inline-flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            Cart · {cart.items.length} item{cart.items.length === 1 ? '' : 's'}
          </span>
          <span className="font-bold">{fmt(cart.totalCents)}</span>
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-black/50 flex items-end" onClick={() => setMobileOpen(false)}>
            <div
              className="bg-white w-full max-h-[85vh] overflow-y-auto border-t-4 border-accent"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-black/10 sticky top-0 bg-white z-10">
                <p className="font-mono text-sm font-bold uppercase tracking-wider">Your cart</p>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="text-black/50 hover:text-black"
                  aria-label="Close cart"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <CartContents
                items={cart.items}
                totalCents={cart.totalCents}
                onRemove={cart.removeItem}
                onCheckout={checkout}
                submitting={submitting}
                error={error}
                phone={phone}
                onPhoneChange={setPhone}
                phoneOk={phoneOk}
                phoneFromProfile={!!profilePhone}
                isAdmin={isAdmin}
                testMode={testMode}
                onTestModeChange={setTestMode}
                noBorder
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared cart content list — used by both desktop sidebar + mobile drawer.
// ──────────────────────────────────────────────────────────────────────
function CartContents({
  items,
  totalCents,
  onRemove,
  onCheckout,
  submitting,
  error,
  phone,
  onPhoneChange,
  phoneOk,
  phoneFromProfile,
  isAdmin,
  testMode,
  onTestModeChange,
  noBorder,
}: {
  items: MediaCartItem[];
  totalCents: number;
  onRemove: (id: string) => void;
  onCheckout: () => void;
  submitting: boolean;
  error: string | null;
  phone: string;
  onPhoneChange: (v: string) => void;
  phoneOk: boolean;
  phoneFromProfile: boolean;
  isAdmin?: boolean;
  testMode?: boolean;
  onTestModeChange?: (v: boolean) => void;
  noBorder?: boolean;
}) {
  // Round 6: 50% deposit charged at checkout. Always rounded down so we
  // never accidentally over-charge the cents — full balance is the
  // remaining amount.
  const depositCents = Math.floor(totalCents / 2);
  const remainderCents = totalCents - depositCents;
  return (
    <div>
      {!noBorder && (
        <div className="p-4 border-b border-black/10 bg-black text-white">
          <p className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
            <ShoppingCart className="w-3.5 h-3.5" />
            Your cart · {items.length}
          </p>
        </div>
      )}
      <ul className="p-4 space-y-3">
        {items.map((it) => (
          <li key={it.id} className="border border-black/10 p-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="font-mono text-sm font-bold uppercase tracking-wider">
                {it.offering.title}
              </p>
              <button
                type="button"
                onClick={() => onRemove(it.id)}
                className="text-black/40 hover:text-red-700 shrink-0"
                aria-label="Remove from cart"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Quick recap line: prefer the songs breakdown if present
                (richer signal), fall back to the legacy `songs` string,
                then to the project name, else "No project info yet". */}
            <p className="font-mono text-xs text-black/60 mb-1.5 line-clamp-1">
              {(() => {
                const sb = it.projectDetails.songs_breakdown ?? [];
                if (sb.length > 0) {
                  return sb
                    .map((s) => s.title.trim())
                    .filter((t) => t.length > 0)
                    .join(', ') || 'Songs not yet specified';
                }
                if (it.projectDetails.songs) return it.projectDetails.songs;
                if (it.projectDetails.project_name) return it.projectDetails.project_name;
                return <span className="text-black/35">No project info yet</span>;
              })()}
            </p>
            {it.projectDetails.vibe && (
              <p className="font-mono text-xs text-black/50 italic line-clamp-1 mb-2">
                {it.projectDetails.vibe}
              </p>
            )}
            <p className="font-mono text-sm font-bold text-accent">
              {fmt(it.computedPriceCents)}
            </p>
          </li>
        ))}
      </ul>
      <div className="p-4 border-t border-black/10 bg-black/[0.02] space-y-3">
        {/* Order summary — order total broken into deposit (charged now)
            + remainder (billed by admin after the planning call). */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-black/55">
              Order total
            </span>
            <span className="font-mono text-sm font-bold">{fmt(totalCents)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-black/55">
              Remainder (billed later)
            </span>
            <span className="font-mono text-xs text-black/55">
              {fmt(remainderCents)}
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-2 border-t border-black/10">
            <span className="font-mono text-xs uppercase tracking-wider font-bold">
              Charged today (50%)
            </span>
            <span className="text-xl font-bold tracking-tight">
              {fmt(depositCents)}
            </span>
          </div>
        </div>

        {/* Phone capture — required if not on profile, editable either
            way so a buyer can override. */}
        <div className="pt-2">
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-black/55 mb-1 inline-flex items-center gap-1">
              <Phone className="w-3 h-3" />
              Phone for follow-up call
              {phoneFromProfile && (
                <span className="text-black/35">· from profile</span>
              )}
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              placeholder="(260) 555-0123"
              className={`w-full bg-white border-2 px-2.5 py-1.5 text-sm focus:border-black outline-none ${
                phoneOk ? 'border-black/15' : 'border-yellow-400'
              }`}
            />
          </label>
          <p className="font-mono text-[10px] text-black/45 mt-1">
            We&apos;ll call to plan dates, scope, and the remaining balance.
          </p>
        </div>

        {/* Admin-only: test-mode toggle. When on, the Checkout button
            calls /api/admin/media/test-checkout instead of Stripe and
            writes rows with is_test=true so accounting stays clean. */}
        {isAdmin && (
          <label className="flex items-start gap-2 px-3 py-2 bg-black/[0.04] border border-dashed border-black/30 cursor-pointer">
            <input
              type="checkbox"
              checked={!!testMode}
              onChange={(e) => onTestModeChange?.(e.target.checked)}
              className="mt-0.5"
            />
            <span className="font-mono text-[10px] text-black/70 leading-tight">
              <strong>ADMIN · Test mode</strong> — skip Stripe, mark{' '}
              <code className="text-[10px]">is_test=true</code>, excluded from
              accounting. Use to QA the cart flow without real charges.
            </span>
          </label>
        )}

        {error && (
          <p className="font-mono text-[11px] text-red-700">{error}</p>
        )}
        <button
          type="button"
          onClick={onCheckout}
          disabled={submitting || items.length === 0 || (!testMode && !phoneOk)}
          className={`w-full font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            testMode
              ? 'bg-purple-700 text-white hover:bg-purple-800'
              : 'bg-black text-white hover:bg-accent hover:text-black'
          }`}
        >
          {submitting
            ? 'Processing…'
            : testMode
            ? `[TEST] Simulate · ${fmt(depositCents)}`
            : `Checkout · ${fmt(depositCents)}`}
          {!submitting && <ArrowRight className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}
