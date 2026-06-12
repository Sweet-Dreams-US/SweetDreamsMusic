'use client';

import { useState, useEffect } from 'react';
import {
  Users, Calendar, FileText, Music, TrendingUp, Eye,
  BarChart3, Globe, BookOpen, DollarSign, Activity,
} from 'lucide-react';

interface AnalyticsData {
  totals: {
    users: number;
    bookings: number;
    deliverables: number;
    beatPurchases: number;
    beatRevenue: number;
    mediaSales: number;
    fileDownloads: number;
  };
  thisMonth: {
    newUsers: number;
    bookings: number;
    deliverables: number;
    revenue: number;
    bookingRevenue: number;
    beatRevenue: number;
    mediaRevenue: number;
  };
  content: {
    blogPostsPublished: number;
    totalBlogViews: number;
    activeBeats: number;
    publicProfiles: number;
  };
  bookingsByStatus: Record<string, number>;
  activeUsersThisWeek: number;
  featureUsage: Record<string, number>;
  topClients: { name: string; email: string; count: number }[];
  topBlogPosts: { title: string; slug: string; views: number }[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`border-2 p-4 ${accent ? 'border-accent' : 'border-black/10'}`}>
      <Icon className={`w-4 h-4 mb-2 ${accent ? 'text-accent' : 'text-black/30'}`} />
      <p className={`font-heading text-xl ${accent ? 'text-accent' : ''}`}>{value}</p>
      <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-black/10 px-3 py-2">
      <p className="font-mono text-sm font-bold">{value}</p>
      <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">{title}</h3>
  );
}

export default function PlatformAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/analytics')
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-black/20 border-t-black rounded-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border-2 border-red-200 bg-red-50 p-6 text-center">
        <p className="font-mono text-sm text-red-600">{error || 'Failed to load analytics'}</p>
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    confirmed: 'Confirmed',
    completed: 'Completed',
    pending: 'Pending',
    pending_approval: 'Pending Approval',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
    no_show: 'No Show',
  };

  const featureLabels: Record<string, string> = {
    file_download: 'File Downloads',
    beat_preview: 'Beat Previews',
    profile_view: 'Profile Views',
    beat_purchase: 'Beat Purchases',
    session_booked: 'Sessions Booked',
    page_view: 'Page Views',
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-5 h-5" />
        <h2 className="font-heading text-2xl">Platform Analytics</h2>
      </div>

      {/* Row 1 — Key Metrics */}
      <div>
        <SectionHeader title="Key Metrics — All Time" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Users} label="Total Users" value={data.totals.users.toLocaleString()} accent />
          <StatCard icon={Calendar} label="Total Sessions" value={data.totals.bookings.toLocaleString()} />
          <StatCard icon={FileText} label="Files Delivered" value={data.totals.deliverables.toLocaleString()} />
          <StatCard icon={Music} label="Beat Purchases" value={data.totals.beatPurchases.toLocaleString()} />
        </div>
      </div>

      {/* Row 2 — Growth This Month */}
      <div>
        <SectionHeader title="Growth — This Month" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={TrendingUp} label="New Users" value={`+${data.thisMonth.newUsers}`} accent />
          <StatCard icon={Calendar} label="Sessions" value={data.thisMonth.bookings.toLocaleString()} />
          <StatCard icon={FileText} label="Files Uploaded" value={data.thisMonth.deliverables.toLocaleString()} />
          <StatCard icon={DollarSign} label="Revenue" value={formatCurrency(data.thisMonth.revenue)} accent />
        </div>
        {/* Revenue breakdown mini stats */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <MiniStat label="Session Revenue" value={formatCurrency(data.thisMonth.bookingRevenue)} />
          <MiniStat label="Beat Revenue" value={formatCurrency(data.thisMonth.beatRevenue)} />
          <MiniStat label="Media Revenue" value={formatCurrency(data.thisMonth.mediaRevenue)} />
        </div>
      </div>

      {/* Row 3 — Content Stats */}
      <div>
        <SectionHeader title="Content & Platform" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={BookOpen} label="Blog Posts" value={data.content.blogPostsPublished.toLocaleString()} />
          <StatCard icon={Eye} label="Total Blog Views" value={data.content.totalBlogViews.toLocaleString()} />
          <StatCard icon={Music} label="Beats in Store" value={data.content.activeBeats.toLocaleString()} />
          <StatCard icon={Globe} label="Public Profiles" value={data.content.publicProfiles.toLocaleString()} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
          <MiniStat label="Active Users (7d)" value={data.activeUsersThisWeek.toLocaleString()} />
          <MiniStat label="File Downloads" value={data.totals.fileDownloads.toLocaleString()} />
          <MiniStat label="Media Sales" value={data.totals.mediaSales.toLocaleString()} />
        </div>
      </div>

      {/* Booking Status Breakdown */}
      {Object.keys(data.bookingsByStatus).length > 0 && (
        <div>
          <SectionHeader title="Bookings by Status" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(data.bookingsByStatus)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => (
                <MiniStat
                  key={status}
                  label={statusLabels[status] || status}
                  value={count.toLocaleString()}
                />
              ))}
          </div>
        </div>
      )}

      {/* Feature Usage */}
      {Object.keys(data.featureUsage).length > 0 && (
        <div>
          <SectionHeader title="Feature Usage" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(data.featureUsage)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <MiniStat
                  key={type}
                  label={featureLabels[type] || type.replace(/_/g, ' ')}
                  value={count.toLocaleString()}
                />
              ))}
          </div>
        </div>
      )}

      {/* Row 4 — Top Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Clients */}
        <div>
          <SectionHeader title="Top 5 Clients — by Session Count" />
          <div className="border-2 border-black/10 divide-y divide-black/5">
            {data.topClients.length === 0 && (
              <p className="font-mono text-sm text-black/40 text-center py-8">No booking data yet</p>
            )}
            {data.topClients.map((client, i) => (
              <div key={client.email || i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs font-bold text-black/30 w-5 shrink-0">
                    {i + 1}.
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold truncate">{client.name}</p>
                    <p className="font-mono text-[10px] text-black/40 truncate">{client.email}</p>
                  </div>
                </div>
                <span className="font-mono text-sm font-bold shrink-0 ml-3">
                  {client.count} {client.count === 1 ? 'session' : 'sessions'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Blog Posts */}
        <div>
          <SectionHeader title="Top 5 Blog Posts — by Views" />
          <div className="border-2 border-black/10 divide-y divide-black/5">
            {data.topBlogPosts.length === 0 && (
              <p className="font-mono text-sm text-black/40 text-center py-8">No blog data yet</p>
            )}
            {data.topBlogPosts.map((post, i) => (
              <div key={post.slug || i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs font-bold text-black/30 w-5 shrink-0">
                    {i + 1}.
                  </span>
                  <p className="font-mono text-sm truncate">{post.title}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  <Eye className="w-3 h-3 text-black/30" />
                  <span className="font-mono text-sm font-bold">{post.views.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Beat revenue all-time */}
      <div>
        <SectionHeader title="All-Time Revenue" />
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Beat Revenue (All Time)" value={formatCurrency(data.totals.beatRevenue)} />
          <MiniStat
            label="Avg per Beat Sale"
            value={
              data.totals.beatPurchases > 0
                ? formatCurrency(Math.round(data.totals.beatRevenue / data.totals.beatPurchases))
                : '$0.00'
            }
          />
        </div>
      </div>
    </div>
  );
}
