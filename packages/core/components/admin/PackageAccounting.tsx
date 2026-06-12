'use client';

// components/admin/PackageAccounting.tsx
//
// Round F2: packages section inside the Accounting view.
// Surfaces the dollar story Cole asked for at the start of the
// packages feature: "track every dollar." Specifically:
//
//   • Active memberships + their MRR-equivalent
//   • Active one-offs + cash collected
//   • Total discount absorbed (margin sacrificed for active deals)
//   • Unredeemed liability (work the studio still owes customers)
//   • Forfeit revenue (cash kept, value not delivered — pure margin
//     on entitlements that expired with leftover pieces)
//   • Redemption breakdown by line type — shows what customers
//     actually do with what they bought
//   • Payment status breakdown — visibility into past_due /
//     collections / written_off cases for membership dunning

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Package, TrendingUp, Crown, Calendar, Clock, Film, Music, AlertTriangle } from 'lucide-react';

interface Summary {
  active_memberships_count: number;
  active_oneoffs_count: number;
  monthly_recurring_revenue_cents: number;
  oneoff_cash_collected_cents: number;
  total_discount_absorbed_cents: number;
  unredeemed_liability_cents: number;
  forfeit_revenue_cents: number;
  redemption_breakdown_cents: Record<'studio_hours' | 'media_offering' | 'beat_credit' | 'custom', number>;
  payment_status_breakdown: Record<'current' | 'past_due' | 'collections' | 'written_off', number>;
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PackageAccounting() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/packages/accounting', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setError('Could not load accounting summary.');
          return;
        }
        const body = await res.json();
        setData(body as Summary);
      } catch {
        if (!cancelled) setError('Network error.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-700" />
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-black/40" />
      </div>
    );
  }

  const totalActive = data.active_memberships_count + data.active_oneoffs_count;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <Package className="w-4 h-4 text-black/55" />
        <h3 className="font-bold text-base">Packages & Memberships</h3>
        <span className="font-mono text-[11px] text-black/55">
          {totalActive} active
        </span>
      </div>

      {totalActive === 0 && data.forfeit_revenue_cents === 0 && data.oneoff_cash_collected_cents === 0 ? (
        <p className="font-mono text-xs text-black/45 italic">
          No package activity yet. As entitlements get minted, this section fills with revenue,
          discount, and liability data.
        </p>
      ) : (
        <>
          {/* Top-line cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card
              icon={Crown}
              label="Active memberships"
              value={String(data.active_memberships_count)}
              sub={data.monthly_recurring_revenue_cents > 0 ? `${fmt(data.monthly_recurring_revenue_cents)}/mo MRR` : undefined}
            />
            <Card
              icon={Calendar}
              label="Active one-offs"
              value={String(data.active_oneoffs_count)}
              sub={`${fmt(data.oneoff_cash_collected_cents)} lifetime cash`}
            />
            <Card
              icon={TrendingUp}
              label="Discount absorbed"
              value={fmt(data.total_discount_absorbed_cents)}
              sub="margin sacrificed (active)"
              warn
            />
            <Card
              icon={Clock}
              label="Unredeemed liability"
              value={fmt(data.unredeemed_liability_cents)}
              sub="value owed to customers"
            />
          </div>

          {/* Forfeit revenue callout — the silver lining when entitlements
              expire with leftover pieces. */}
          {data.forfeit_revenue_cents > 0 && (
            <div className="border-2 border-green-600 bg-green-50 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-green-900 mb-1">
                Forfeit revenue
              </p>
              <p className="font-bold text-base text-green-900">
                {fmt(data.forfeit_revenue_cents)}
              </p>
              <p className="font-mono text-[11px] text-green-900 mt-1">
                Cash collected on entitlements that expired with unredeemed pieces. Pure margin to studio.
              </p>
            </div>
          )}

          {/* Redemption breakdown */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/55 mb-2">
              Redeemed value (retail-equivalent, by line type)
            </p>
            <ul className="space-y-1">
              <RedemptionRow
                icon={Clock}
                label="Studio hours"
                cents={data.redemption_breakdown_cents.studio_hours}
              />
              <RedemptionRow
                icon={Film}
                label="Media offerings"
                cents={data.redemption_breakdown_cents.media_offering}
              />
              <RedemptionRow
                icon={Music}
                label="Beat credits"
                cents={data.redemption_breakdown_cents.beat_credit}
              />
              <RedemptionRow
                icon={Package}
                label="Custom"
                cents={data.redemption_breakdown_cents.custom}
              />
            </ul>
          </div>

          {/* Payment status (membership dunning visibility) */}
          {(data.payment_status_breakdown.past_due > 0 ||
            data.payment_status_breakdown.collections > 0 ||
            data.payment_status_breakdown.written_off > 0) && (
            <div className="border-2 border-orange-400 bg-orange-50 p-3 space-y-1.5">
              <div className="inline-flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-900" />
                <p className="font-mono text-[10px] uppercase tracking-wider text-orange-900 font-bold">
                  Payment dunning
                </p>
              </div>
              {data.payment_status_breakdown.past_due > 0 && (
                <p className="font-mono text-xs text-orange-900">
                  {data.payment_status_breakdown.past_due} entitlement(s) past_due — Stripe is retrying
                </p>
              )}
              {data.payment_status_breakdown.collections > 0 && (
                <p className="font-mono text-xs text-orange-900">
                  {data.payment_status_breakdown.collections} entitlement(s) in collections
                </p>
              )}
              {data.payment_status_breakdown.written_off > 0 && (
                <p className="font-mono text-xs text-orange-900">
                  {data.payment_status_breakdown.written_off} entitlement(s) written off
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({
  icon: Icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className={`border-2 p-3 ${warn ? 'border-orange-300 bg-orange-50' : 'border-black/15'}`}>
      <div className="inline-flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${warn ? 'text-orange-700' : 'text-black/45'}`} />
        <p className="font-mono text-[9px] uppercase tracking-wider text-black/55">{label}</p>
      </div>
      <p className={`font-bold text-base ${warn ? 'text-orange-900' : 'text-black'}`}>{value}</p>
      {sub && <p className="font-mono text-[10px] text-black/45 mt-0.5">{sub}</p>}
    </div>
  );
}

function RedemptionRow({
  icon: Icon,
  label,
  cents,
}: {
  icon: typeof Clock;
  label: string;
  cents: number;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1 border-b border-black/5">
      <div className="inline-flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-black/45" />
        <span className="font-mono text-xs">{label}</span>
      </div>
      <span className="font-mono text-xs font-bold">{fmt(cents)}</span>
    </li>
  );
}
