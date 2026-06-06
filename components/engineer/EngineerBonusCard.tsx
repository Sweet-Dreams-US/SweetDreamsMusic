'use client';

// Engineer bonus progress (read-only). Monthly milestone (one total) + the
// quarterly $1/hr kicker, gated to the rewards launch date (no back-pay). The
// payout itself runs through the admin/payroll flow — this is just visibility.

import { useEffect, useState } from 'react';
import { Gift, TrendingUp } from 'lucide-react';

interface BonusData {
  engineerName: string | null;
  launched: boolean;
  launchDate: string | null;
  monthHours: number;
  quarterHours: number;
  monthlyBonusCents: number;
  monthlyTierHrs: number;
  nextMonthly: { threshold: number; bonusCents: number } | null;
  quarterlyKickerCents: number;
}

const fmt = (c: number) => `$${(c / 100).toFixed(0)}`;

export default function EngineerBonusCard() {
  const [data, setData] = useState<BonusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/engineer/rewards', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive && !d.error) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading || !data || !data.engineerName) return null;

  const projected = data.monthlyBonusCents + data.quarterlyKickerCents;

  return (
    <div className="border-2 border-black/10 p-4 sm:p-5 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Gift className="w-4 h-4 text-[#F4C430]" />
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider">Your Bonuses</h3>
        {!data.launched && (
          <span className="font-mono text-[10px] uppercase tracking-wider bg-black/5 text-black/50 px-2 py-0.5">
            Begins at launch
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Monthly milestone */}
        <div className="border border-black/10 p-3">
          <p className="font-mono text-[10px] text-black/50 uppercase tracking-wider">This month</p>
          <p className="font-mono text-lg font-bold">{data.monthHours} hrs</p>
          <p className="font-mono text-xs text-black/60">
            {data.monthlyBonusCents > 0
              ? <>Bonus earned: <span className="font-bold text-green-700">{fmt(data.monthlyBonusCents)}</span></>
              : 'No milestone yet'}
          </p>
          {data.nextMonthly && (
            <p className="font-mono text-[10px] text-black/40 mt-1">
              {data.nextMonthly.threshold - data.monthHours} hrs → {fmt(data.nextMonthly.bonusCents)}
            </p>
          )}
        </div>

        {/* Quarterly kicker */}
        <div className="border border-black/10 p-3">
          <p className="font-mono text-[10px] text-black/50 uppercase tracking-wider">This quarter</p>
          <p className="font-mono text-lg font-bold">{data.quarterHours} hrs</p>
          <p className="font-mono text-xs text-black/60">
            $1/hr kicker: <span className="font-bold text-green-700">{fmt(data.quarterlyKickerCents)}</span>
          </p>
          <p className="font-mono text-[10px] text-black/40 mt-1">On top of monthly</p>
        </div>

        {/* Projected total */}
        <div className="border border-black/10 p-3 bg-[#F4C430]/5">
          <p className="font-mono text-[10px] text-black/50 uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Projected
          </p>
          <p className="font-mono text-lg font-bold text-green-700">{fmt(projected)}</p>
          <p className="font-mono text-[10px] text-black/40 mt-1">Month milestone + quarter kicker</p>
        </div>
      </div>

      <p className="font-mono text-[10px] text-black/40 mt-3">
        Paid out via payroll. Bonuses come from the studio&apos;s cut, on top of your normal pay.
      </p>
    </div>
  );
}
