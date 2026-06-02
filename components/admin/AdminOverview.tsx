'use client';

import { useState, useEffect } from 'react';
import { Calendar, DollarSign, Users, Music, ShoppingBag } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { fmtSessionDateTime, fmtStampDate } from '@/lib/studio-time';
import AttentionCenter from './attention/AttentionCenter';
import type { AdminTab } from './attention/types';

interface OverviewData {
  today: { sessions: number; revenue: number; signups: number };
  week: { sessions: number; revenue: number; beatsSold: number; beatsRevenue: number };
  month: {
    sessions: number;
    revenue: number;
    beatsSold: number;
    beatsRevenue: number;
    mediaSales: number;
    mediaRevenue: number;
  };
  status: { pendingBookings: number; upcomingSessions: number; outstandingRemainders: number };
  recentBookings: { id: string; name: string; date: string; status: string; amount: number }[];
  recentBeatSales: {
    id: string;
    buyer: string;
    title: string;
    producer: string;
    license: string;
    amount: number;
    date: string;
  }[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  pending_approval: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  rejected: 'bg-red-100 text-red-600',
};

function KpiCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
  sub?: string;
}) {
  return (
    <div className="border-2 border-black/10 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-black/40" />
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-black/50">
          {label}
        </span>
      </div>
      <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight">{value}</p>
      {sub && <p className="font-mono text-xs text-black/40 mt-1">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-black/50 mb-3">
      {children}
    </h3>
  );
}

export default function AdminOverview({ onNavigate }: { onNavigate: (tab: AdminTab) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/overview')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load overview');
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // recentBookings.date = bookings.start_time (wall-clock-as-UTC) → fmtSession*
  // recentBeatSales.date = beat_purchases.created_at (true-UTC) → fmtStamp*

  return (
    <div className="space-y-8">
      {/* COMMAND CENTER — independent fetch; renders regardless of the KPI fetch below */}
      <AttentionCenter onNavigate={onNavigate} />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="font-mono text-sm uppercase tracking-wider text-black/40 animate-pulse">
            Loading overview...
          </div>
        </div>
      )}

      {!loading && (error || !data) && (
        <div className="border-2 border-red-200 bg-red-50 p-6 text-center">
          <p className="font-mono text-sm text-red-600">{error || 'Failed to load'}</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* TODAY */}
          <div>
            <SectionTitle>Today</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard label="Sessions Today" value={String(data.today.sessions)} icon={Calendar} />
              <KpiCard
                label="Revenue Today"
                value={formatCents(data.today.revenue)}
                icon={DollarSign}
                sub="Deposits collected"
              />
              <KpiCard label="New Signups" value={String(data.today.signups)} icon={Users} />
            </div>
          </div>

          {/* THIS WEEK */}
          <div>
            <SectionTitle>This Week</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard label="Sessions" value={String(data.week.sessions)} icon={Calendar} />
              <KpiCard label="Session Revenue" value={formatCents(data.week.revenue)} icon={DollarSign} />
              <KpiCard
                label="Beats Sold"
                value={String(data.week.beatsSold)}
                icon={Music}
                sub={data.week.beatsRevenue > 0 ? formatCents(data.week.beatsRevenue) : undefined}
              />
            </div>
          </div>

          {/* THIS MONTH */}
          <div>
            <SectionTitle>This Month</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Total Sessions" value={String(data.month.sessions)} icon={Calendar} />
              <KpiCard label="Session Revenue" value={formatCents(data.month.revenue)} icon={DollarSign} />
              <KpiCard
                label="Beats Sold"
                value={String(data.month.beatsSold)}
                icon={Music}
                sub={data.month.beatsRevenue > 0 ? formatCents(data.month.beatsRevenue) : undefined}
              />
              <KpiCard
                label="Media Sales"
                value={String(data.month.mediaSales)}
                icon={ShoppingBag}
                sub={data.month.mediaRevenue > 0 ? formatCents(data.month.mediaRevenue) : undefined}
              />
            </div>
          </div>

          {/* RECENT ACTIVITY */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Recent Bookings */}
            <div>
              <SectionTitle>Recent Bookings</SectionTitle>
              <div className="border-2 border-black/10 divide-y divide-black/5">
                {data.recentBookings.length === 0 ? (
                  <div className="p-4 text-center font-mono text-sm text-black/40">
                    No bookings yet
                  </div>
                ) : (
                  data.recentBookings.map((b) => (
                    <div key={b.id} className="p-3 sm:p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold truncate">{b.name}</p>
                        <p className="font-mono text-xs text-black/40">{fmtSessionDateTime(b.date)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-mono text-xs font-semibold">{formatCents(b.amount)}</span>
                        <span
                          className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            STATUS_COLORS[b.status] || 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {b.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent Beat Sales */}
            <div>
              <SectionTitle>Recent Beat Sales</SectionTitle>
              <div className="border-2 border-black/10 divide-y divide-black/5">
                {data.recentBeatSales.length === 0 ? (
                  <div className="p-4 text-center font-mono text-sm text-black/40">
                    No beat sales yet
                  </div>
                ) : (
                  data.recentBeatSales.map((s) => (
                    <div key={s.id} className="p-3 sm:p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold truncate">{s.title}</p>
                        <p className="font-mono text-xs text-black/40 truncate">
                          {s.buyer} &middot; {s.license}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="font-mono text-sm font-semibold">{formatCents(s.amount)}</p>
                        <p className="font-mono text-[10px] text-black/40">{fmtStampDate(s.date)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
