'use client';

// components/hub/ActivePackages.tsx
//
// Round E Phase 1: customer-facing view of their active packages
// inside the Artist Hub. Renders one card per entitlement with
// progress bars per balance type.
//
// The component returns null when the customer has no entitlements
// (active or otherwise) — most users won't, and we don't want a
// pointless empty section on every hub overview load.
//
// Future rounds will add:
//   • "Redeem hours" button → opens RedeemSessionModal (Phase 4)
//   • "Request more" button → opens RequestMoreModal (Phase 2)
//   • Per-balance redeem actions for media offerings + beat credits

import { useEffect, useState } from 'react';
import { Loader2, Package, Crown, Users, Clock, Film, Music, Calendar, AlertCircle, CheckCircle2, Plus, Zap, CreditCard } from 'lucide-react';
import RequestMoreModal from './RequestMoreModal';
import RedeemSessionModal from './RedeemSessionModal';
import RedeemBeatModal from './RedeemBeatModal';
import RedeemMediaModal from './RedeemMediaModal';
import { fmtStampDate } from '@/lib/studio-time';

interface Balance {
  id: string;
  kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  media_offering_id: string | null;
  full_price_cents: number;
  notes: string | null;
  quantity_granted: number;
  quantity_redeemed: number;
}

interface Entitlement {
  id: string;
  status: 'active' | 'exhausted' | 'expired';
  payment_status: 'current' | 'past_due' | 'collections' | 'written_off';
  starts_at: string;
  ends_at: string;
  band_id: string | null;
  band_name: string | null;
  has_stripe_subscription: boolean;
  template_name: string;
  template_description: string | null;
  template_is_membership: boolean;
  template_membership_months: number | null;
  template_duration_days: number | null;
  balances: Balance[];
}


function balanceLabel(b: Balance): string {
  if (b.kind === 'studio_hours') {
    const remaining = b.quantity_granted - b.quantity_redeemed;
    return `${remaining}/${b.quantity_granted} studio hour${b.quantity_granted === 1 ? '' : 's'} left`;
  }
  if (b.kind === 'beat_credit') {
    const remaining = b.quantity_granted - b.quantity_redeemed;
    return `${remaining}/${b.quantity_granted} beat credit${b.quantity_granted === 1 ? '' : 's'} left`;
  }
  // media_offering or custom
  const remaining = b.quantity_granted - b.quantity_redeemed;
  const used = b.quantity_redeemed > 0 ? ' (used)' : '';
  return `${b.notes || (b.kind === 'media_offering' ? 'Media offering' : 'Custom item')}: ${remaining}/${b.quantity_granted}${used}`;
}

function balanceIcon(kind: Balance['kind']) {
  switch (kind) {
    case 'studio_hours': return Clock;
    case 'media_offering': return Film;
    case 'beat_credit': return Music;
    case 'custom': return Package;
  }
}

export default function ActivePackages() {
  const [entitlements, setEntitlements] = useState<Entitlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestingFor, setRequestingFor] = useState<Entitlement | null>(null);
  const [redeemingFor, setRedeemingFor] = useState<Entitlement | null>(null);
  const [redeemingBeatFor, setRedeemingBeatFor] = useState<Entitlement | null>(null);
  const [redeemingMediaFor, setRedeemingMediaFor] = useState<{ ent: Entitlement; balance: Balance } | null>(null);
  const [openingPortal, setOpeningPortal] = useState<string | null>(null);

  // Pop the Stripe Billing Portal in a new tab so the customer can
  // update their card if a payment failed (or just review billing).
  async function openBillingPortal(entitlementId: string) {
    setOpeningPortal(entitlementId);
    try {
      const res = await fetch(`/api/packages/entitlements/${entitlementId}/billing-portal`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.error || 'Could not open billing portal.');
        return;
      }
      if (body?.portal_url) window.open(body.portal_url as string, '_blank');
    } finally {
      setOpeningPortal(null);
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/packages/entitlements', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load packages.');
        return;
      }
      const body = await res.json();
      setEntitlements((body.entitlements ?? []) as Entitlement[]);
    } catch {
      setError('Network error.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Loading: minimal skeleton, hide instead of flashing.
  if (entitlements === null) return null;

  // No packages? Don't render anything — most users won't have one,
  // and an empty section adds friction to the overview.
  if (entitlements.length === 0) return null;

  // Sort: active first (with valid payment), then past_due, then exhausted, then expired.
  const sorted = [...entitlements].sort((a, b) => {
    const score = (e: Entitlement) =>
      e.status === 'active' && e.payment_status === 'current' ? 0 :
      e.status === 'active' && e.payment_status === 'past_due' ? 1 :
      e.status === 'active' ? 2 :
      e.status === 'exhausted' ? 3 :
      4;
    return score(a) - score(b);
  });

  return (
    <>
      <section>
        <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-2">
          Your Packages
        </p>
        <h2 className="text-2xl font-bold mb-4">ACTIVE BUNDLES & MEMBERSHIPS</h2>

        {error && (
          <div className="border-2 border-red-300 bg-red-50 p-3 mb-4 inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-700" />
            <p className="font-mono text-sm text-red-900">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sorted.map((ent) => {
            const isExpired = ent.status === 'expired' || new Date(ent.ends_at) < new Date();
            const isExhausted = ent.status === 'exhausted';
            const isPastDue = ent.payment_status === 'past_due';
            const fadedClass = (isExpired || isExhausted) ? 'opacity-60' : '';
            const borderClass =
              isPastDue ? 'border-orange-400' :
              isExpired ? 'border-black/10' :
              ent.status === 'active' ? 'border-accent' :
              'border-black/15';

            return (
              <div
                key={ent.id}
                className={`border-2 ${borderClass} ${fadedClass} p-4`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-base truncate">{ent.template_name}</h3>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {ent.template_is_membership ? (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-accent text-black font-bold inline-flex items-center gap-1">
                          <Crown className="w-2.5 h-2.5" />
                          {ent.template_membership_months}-Month
                        </span>
                      ) : (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/30 font-bold inline-flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" />
                          {ent.template_duration_days}-Day
                        </span>
                      )}
                      {ent.band_name && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/30 font-bold inline-flex items-center gap-1">
                          <Users className="w-2.5 h-2.5" />
                          {ent.band_name}
                        </span>
                      )}
                      {isPastDue && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-orange-400 text-black font-bold">
                          Payment past due
                        </span>
                      )}
                      {isExhausted && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-black/10 text-black/60 font-bold inline-flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Exhausted
                        </span>
                      )}
                      {isExpired && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-black/10 text-black/60 font-bold">
                          Expired
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Expires</p>
                    <p className="font-mono text-xs font-bold">{fmtStampDate(ent.ends_at, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                </div>

                {/* Balances */}
                {ent.balances.length > 0 && (
                  <ul className="space-y-2 mt-3 pt-3 border-t border-black/10">
                    {ent.balances.map((b) => {
                      const Icon = balanceIcon(b.kind);
                      const used = b.quantity_redeemed;
                      const total = b.quantity_granted;
                      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
                      return (
                        <li key={b.id}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="inline-flex items-center gap-1.5 min-w-0">
                              <Icon className="w-3 h-3 text-black/45 shrink-0" />
                              <span className="font-mono text-[11px] truncate">{balanceLabel(b)}</span>
                            </div>
                            <span className="font-mono text-[10px] text-black/45 shrink-0">{pct}% used</span>
                          </div>
                          <div className="h-1.5 bg-black/10 overflow-hidden">
                            <div
                              className={`h-full ${pct === 100 ? 'bg-black/40' : 'bg-accent'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Actions — only for active, current entitlements */}
                {ent.status === 'active' && !isExpired && (
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-black/10 flex-wrap">
                    {/* Redeem session button — only when there are
                        studio_hours remaining. */}
                    {ent.balances.some((b) => b.kind === 'studio_hours' && b.quantity_redeemed < b.quantity_granted) && (
                      <button
                        onClick={() => setRedeemingFor(ent)}
                        className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-black text-white inline-flex items-center gap-1.5"
                      >
                        <Zap className="w-3 h-3" />
                        Book Studio Time
                      </button>
                    )}
                    {/* Beat credit redemption */}
                    {ent.balances.some((b) => b.kind === 'beat_credit' && b.quantity_redeemed < b.quantity_granted) && (
                      <button
                        onClick={() => setRedeemingBeatFor(ent)}
                        className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-black text-white inline-flex items-center gap-1.5"
                      >
                        <Music className="w-3 h-3" />
                        Claim Beat
                      </button>
                    )}
                    {/* Media offering redemption — one button per
                        unredeemed media balance (since each line is a
                        specific offering) */}
                    {ent.balances
                      .filter((b) => b.kind === 'media_offering' && b.quantity_redeemed < b.quantity_granted)
                      .map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setRedeemingMediaFor({ ent, balance: b })}
                          className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-black text-white inline-flex items-center gap-1.5"
                        >
                          <Film className="w-3 h-3" />
                          Start: {b.notes ?? 'media offering'}
                        </button>
                      ))}
                    <button
                      onClick={() => setRequestingFor(ent)}
                      className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 border border-black/20 hover:border-black inline-flex items-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" />
                      Request More
                    </button>
                    {/* Stripe billing portal — only for memberships with
                        an active Stripe subscription. Lets customers
                        update their card if a payment fails. */}
                    {ent.has_stripe_subscription && (
                      <button
                        onClick={() => openBillingPortal(ent.id)}
                        disabled={openingPortal === ent.id}
                        className={`font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50 ${
                          isPastDue
                            ? 'bg-orange-400 text-black hover:bg-orange-500'
                            : 'border border-black/20 hover:border-black'
                        }`}
                      >
                        {openingPortal === ent.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CreditCard className="w-3 h-3" />
                        )}
                        Manage Payment
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {requestingFor && (
        <RequestMoreModal
          entitlement={requestingFor}
          onClose={() => setRequestingFor(null)}
          onSubmitted={() => {
            setRequestingFor(null);
            // No need to refresh entitlements — the request doesn't change them.
          }}
        />
      )}

      {redeemingFor && (
        <RedeemSessionModal
          entitlement={redeemingFor}
          onClose={() => setRedeemingFor(null)}
          onRedeemed={() => {
            setRedeemingFor(null);
            refresh();
          }}
        />
      )}

      {redeemingBeatFor && (
        <RedeemBeatModal
          entitlement={redeemingBeatFor}
          onClose={() => setRedeemingBeatFor(null)}
          onRedeemed={() => {
            setRedeemingBeatFor(null);
            refresh();
          }}
        />
      )}

      {redeemingMediaFor && (
        <RedeemMediaModal
          entitlementId={redeemingMediaFor.ent.id}
          templateName={redeemingMediaFor.ent.template_name}
          balance={redeemingMediaFor.balance}
          onClose={() => setRedeemingMediaFor(null)}
          onRedeemed={() => {
            setRedeemingMediaFor(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
