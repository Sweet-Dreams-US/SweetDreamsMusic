'use client';

// components/admin/MarketingDashboard.tsx — the admin Marketing tab.
//
// Shows Meta ads performance for SWEET DREAMS CAMPAIGNS ONLY (the ad account is
// shared with other businesses; the server filters to ads promoting our
// page/IG — see lib/meta-marketing.ts) next to the money the studio actually
// collected in the same window, giving true ROAS instead of Meta's
// self-reported conversion value.

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, RefreshCw, TrendingUp, MousePointerClick, Eye, DollarSign, UserPlus } from 'lucide-react';
import { formatCents } from '@/lib/utils';

type Campaign = {
  id: string; name: string; status: string;
  spend: number; impressions: number; clicks: number;
  cpc: number | null; cpm: number | null;
  linkClicks: number; leads: number; purchases: number;
};

type MarketingPayload = {
  ads: {
    rangeDays: number; since: string; until: string;
    totals: Omit<Campaign, 'id' | 'name' | 'status'>;
    campaigns: Campaign[];
    excludedAdCount: number; includedAdCount: number;
  };
  revenue: { totalCents: number; sessionsCents: number; beatsCents: number; mediaCents: number; from: string; to: string };
  roas: number | null;
};

type Lead = {
  id: string;
  form_name: string | null;
  campaign_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_time: string | null;
  status: 'new' | 'contacted' | 'converted' | 'ignored';
};

const LEAD_STATUSES: Lead['status'][] = ['new', 'contacted', 'converted', 'ignored'];

const RANGES = [7, 28, 90] as const;

const usd = (n: number | null | undefined, dp = 2) =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));

export default function MarketingDashboard() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(28);
  const [data, setData] = useState<MarketingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/marketing?days=${d}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load');
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load marketing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  // ── Ad leads (Meta lead-ad submissions synced into meta_leads) ──────────
  const [leads, setLeads] = useState<Lead[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [leadsMsg, setLeadsMsg] = useState('');

  const loadLeads = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketing/leads', { cache: 'no-store' });
      const body = await res.json();
      if (res.ok) setLeads(body.leads ?? []);
    } catch { /* leads list is additive — never block the ads view */ }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  async function syncLeads() {
    setSyncing(true);
    setLeadsMsg('');
    try {
      const res = await fetch('/api/admin/marketing/leads', { method: 'POST' });
      const body = await res.json();
      if (res.ok) {
        setLeadsMsg(`Synced: ${body.fetched} lead${body.fetched === 1 ? '' : 's'} across ${body.forms} form${body.forms === 1 ? '' : 's'} (${body.inserted} new).`);
        await loadLeads();
      } else {
        setLeadsMsg(body.error || 'Sync failed');
      }
    } catch {
      setLeadsMsg('Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function setLeadStatus(id: string, status: Lead['status']) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    await fetch('/api/admin/marketing/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    }).catch(() => loadLeads());
  }

  const t = data?.ads.totals;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-heading-md inline-flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-accent" /> MARKETING
          </h2>
          <p className="font-mono text-xs text-black/50 mt-1">
            Meta ads — Sweet Dreams campaigns only
            {data ? ` · ${data.ads.since} → ${data.ads.until}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`font-mono text-xs font-bold px-3 py-2 rounded transition-colors ${
                days === r ? 'bg-black text-white' : 'bg-black/5 text-black/50 hover:bg-black/10'
              }`}
            >
              {r}D
            </button>
          ))}
          <button
            onClick={() => load(days)}
            aria-label="Refresh"
            className="p-2 rounded bg-black/5 text-black/50 hover:bg-black/10 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="border-2 border-red-500/40 bg-red-50 p-4 font-mono text-sm text-red-700 mb-6">
          {error}
        </div>
      )}

      {loading && !data && (
        <p className="font-mono text-sm text-black/50">Loading Meta ads data…</p>
      )}

      {data && t && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            {[
              { label: 'Ad Spend', value: usd(t.spend), icon: DollarSign },
              { label: 'Impressions', value: num(t.impressions), icon: Eye },
              { label: 'Clicks', value: num(t.clicks), icon: MousePointerClick },
              { label: 'CPC', value: usd(t.cpc) },
              { label: 'CPM', value: usd(t.cpm) },
              { label: 'Leads', value: num(t.leads) },
            ].map((c) => (
              <div key={c.label} className="border border-black/10 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">{c.label}</p>
                <p className="font-mono text-lg font-bold">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Ads vs. business — true ROAS from collected revenue */}
          <div className="border-2 border-accent p-5 mb-8">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-accent" /> Ads vs. Business (same {data.ads.rangeDays}-day window)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">Meta Ad Spend</p>
                <p className="font-mono text-2xl font-bold">{usd(t.spend)}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">Collected Revenue</p>
                <p className="font-mono text-2xl font-bold">{formatCents(data.revenue.totalCents)}</p>
                <p className="font-mono text-[10px] text-black/40 mt-1">
                  Sessions {formatCents(data.revenue.sessionsCents)} · Beats {formatCents(data.revenue.beatsCents)} · Media {formatCents(data.revenue.mediaCents)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">Revenue per Ad Dollar</p>
                <p className={`font-mono text-2xl font-bold ${data.roas != null && data.roas >= 1 ? 'text-green-600' : 'text-accent'}`}>
                  {data.roas == null ? '—' : `${data.roas.toFixed(1)}×`}
                </p>
                <p className="font-mono text-[10px] text-black/40 mt-1">
                  All collected revenue ÷ ad spend — a business-level ratio, not per-ad attribution.
                </p>
              </div>
            </div>
          </div>

          {/* Campaign table */}
          <div className="overflow-x-auto border border-black/10">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="bg-black text-white text-left">
                  {['Campaign', 'Status', 'Spend', 'Impressions', 'Clicks', 'CPC', 'Link Clicks', 'Leads', 'Purchases'].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.ads.campaigns.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-black/40">No Sweet Dreams campaigns with activity in this window.</td></tr>
                )}
                {data.ads.campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-black/10">
                    <td className="px-3 py-2.5 max-w-[280px] truncate" title={c.name}>{c.name}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold uppercase ${c.status === 'ACTIVE' ? 'text-green-600' : 'text-black/40'}`}>
                        {c.status || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">{usd(c.spend)}</td>
                    <td className="px-3 py-2.5">{num(c.impressions)}</td>
                    <td className="px-3 py-2.5">{num(c.clicks)}</td>
                    <td className="px-3 py-2.5">{usd(c.cpc)}</td>
                    <td className="px-3 py-2.5">{num(c.linkClicks)}</td>
                    <td className="px-3 py-2.5">{num(c.leads)}</td>
                    <td className="px-3 py-2.5">{num(c.purchases)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="font-mono text-[10px] text-black/40 mt-3">
            Shared ad account: {data.ads.excludedAdCount} ad{data.ads.excludedAdCount === 1 ? '' : 's'} from other
            businesses excluded · {data.ads.includedAdCount} Sweet Dreams ad-rows included. Data cached up to 10 min.
          </p>
        </>
      )}

      {/* ── Ad Leads ─────────────────────────────────────────────────── */}
      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-accent" /> Ad Leads
            <span className="text-black/40 font-normal normal-case tracking-normal">
              — Meta lead-form submissions (auto-syncs hourly)
            </span>
          </h3>
          <button
            onClick={syncLeads}
            disabled={syncing}
            className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 bg-black text-white hover:bg-black/80 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>

        {leadsMsg && (
          <p className={`font-mono text-xs mb-3 ${/not accessible|assign/i.test(leadsMsg) ? 'text-amber-700 border border-amber-400/50 bg-amber-50 p-3' : 'text-black/60'}`}>
            {leadsMsg}
          </p>
        )}

        {leads.length === 0 ? (
          <p className="font-mono text-xs text-black/40 border border-black/10 p-4">
            No ad leads yet. Leads land here automatically when a Meta Lead Ads campaign runs
            (requires the Sweet Dreams Music Page to be assigned to the system user in Business Settings).
          </p>
        ) : (
          <div className="overflow-x-auto border border-black/10">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="bg-black text-white text-left">
                  {['Name', 'Email', 'Phone', 'Campaign', 'Form', 'Submitted', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t border-black/10">
                    <td className="px-3 py-2.5">{l.full_name || '—'}</td>
                    <td className="px-3 py-2.5">
                      {l.email ? <a href={`mailto:${l.email}`} className="text-accent hover:underline">{l.email}</a> : '—'}
                    </td>
                    <td className="px-3 py-2.5">{l.phone || '—'}</td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate" title={l.campaign_name ?? ''}>{l.campaign_name || '—'}</td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" title={l.form_name ?? ''}>{l.form_name || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {l.created_time ? new Date(l.created_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={l.status}
                        onChange={(e) => setLeadStatus(l.id, e.target.value as Lead['status'])}
                        className={`border border-black/20 px-2 py-1 font-mono text-[11px] ${l.status === 'new' ? 'text-accent font-bold' : ''}`}
                      >
                        {LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
