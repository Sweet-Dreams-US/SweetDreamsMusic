'use client';

// components/admin/CreditsLiabilityPanel.tsx
//
// Drop-in widget for the admin Accounting overview that surfaces the
// prepaid-studio-credits liability. The number that matters most is the
// total cents owed — that's what the books show as deferred revenue
// until each credit-hour drains.
//
// Self-contained: fetches /api/admin/media/credits-liability on mount,
// renders summary + per-owner table. No props.

import { useEffect, useState } from 'react';
import { Wallet, AlertCircle } from 'lucide-react';
import { formatCents } from '@/lib/utils';

interface OwnerRow {
  ownerType: 'user' | 'band';
  ownerId: string;
  ownerName: string;
  hoursRemaining: number;
  liabilityCents: number;
}

interface LiabilityResponse {
  totalOutstandingHours: number;
  totalLiabilityCents: number;
  perOwner: OwnerRow[];
  creditCount: number;
}

export default function CreditsLiabilityPanel() {
  const [data, setData] = useState<LiabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/media/credits-liability', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) {
            setError(json.error || 'Could not load credits liability');
            setLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[credits-liability] fetch error:', e);
          setError('Network error');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="border border-black/10 p-4">
        <p className="font-mono text-xs text-black/40">Loading credits liability…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 p-4 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-red-700 mt-0.5" />
        <p className="font-mono text-xs text-red-800">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  const empty = data.creditCount === 0;

  return (
    <div className="border border-black/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-4 h-4 text-accent" />
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider">
          Prepaid Studio Credits — Outstanding Liability
        </h3>
      </div>
      <p className="font-mono text-[11px] text-black/50 mb-4">
        Studio time customers have paid for but not yet drawn. This is deferred revenue
        on the books — it becomes earned when the engineer works the hours.
      </p>

      {empty ? (
        <p className="font-mono text-sm text-black/50">
          No outstanding credits — every prepaid hour has been drawn or no packages have shipped yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Mini label="Outstanding Hours" value={`${data.totalOutstandingHours.toFixed(1)} hr`} />
            <Mini
              label="Liability"
              value={formatCents(data.totalLiabilityCents)}
              accent
            />
            <Mini label="Credit Holders" value={String(data.perOwner.length)} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left font-mono text-[10px] uppercase tracking-wider text-black/50">
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Hours Remaining</th>
                  <th className="py-2">Liability</th>
                </tr>
              </thead>
              <tbody>
                {data.perOwner.map((o) => (
                  <tr key={`${o.ownerType}:${o.ownerId}`} className="border-b border-black/5">
                    <td className="py-2 pr-4 font-bold">{o.ownerName}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-black/60 capitalize">
                      {o.ownerType}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {o.hoursRemaining.toFixed(1)}
                    </td>
                    <td className="py-2 font-mono text-xs font-bold">
                      {formatCents(o.liabilityCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="border border-black/10 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
        {label}
      </p>
      <p
        className={`font-mono text-lg font-bold ${
          accent ? 'text-accent' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}
