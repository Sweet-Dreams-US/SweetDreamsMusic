'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  ChevronDown,
  Check,
  X,
  Gift,
  Rocket,
  SlidersHorizontal,
  AlertTriangle,
  DollarSign,
  Users,
  Clock,
  BarChart3,
  TrendingUp,
  TrendingDown,
  PiggyBank,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Rewards admin control surface. Self-contained — no props. Talks to the
// /api/admin/rewards/* endpoints (overview, grants/:id, recompute, rules).
//
// Money is ALWAYS cents on the wire; this surface formats cents/100 as dollars
// and shows decimal hours as-is. Design language mirrors BookingManager /
// UserManager: font-mono, uppercase tracking-wider labels, border-2 border-black/10
// cards, accent (#F4C430) for primary highlights, no external UI libs.
// ─────────────────────────────────────────────────────────────────────────────

const formatCents = (c: number) => `$${((c || 0) / 100).toFixed(2)}`;

type TabKey = 'users' | 'launch' | 'rules' | 'business';

// ── wire shapes ──────────────────────────────────────────────────────────────
interface Grant {
  id: string;
  rule_key: string;
  track: string;
  counter: string;
  period_key: string;
  reward_type: string;
  reward_value: number;
  value_cents: number;
  status: string;
  counter_value: number;
  threshold: number;
  label: string;
  source: string | null;
  issuance: 'auto' | 'approval';
  expires_at: string | null;
}

interface Owner {
  key: string;
  kind: 'user' | 'band';
  id: string;
  name: string;
  email: string | null;
  counters: Record<string, number>;
  pending: number;
  issued: number;
  approved: number;
  denied: number;
  grants: Grant[];
}

interface OverviewSummary {
  owners: number;
  pending: number;
  approved: number;
  issued: number;
  pendingValueCents: number;
}

interface OverviewResponse {
  summary: OverviewSummary;
  owners: Owner[];
}

interface Rule {
  id: string | null;
  rule_key: string;
  track: string;
  label: string;
  counter: string;
  threshold: number;
  window: string;
  reward_type: string;
  reward_value: number;
  reward_cap_cents: number;
  issuance: 'auto' | 'approval';
  stack_mode: string;
  expires_days: number | null;
  active: boolean;
  sort_order: number;
}

interface RecomputeReport {
  dryRun: boolean;
  customers: number;
  bands: number;
  grantsFound: number;
  grantsInserted: number;
  sample: Array<{ owner: string; label: string; counter_value: number; period: string }>;
  exposure: {
    byType: Record<string, { count: number; estCents: number }>;
    totalEstCents: number;
  };
}

interface RecomputeResponse {
  success: boolean;
  apply: boolean;
  seeded: boolean;
  report: RecomputeReport;
}

interface BusinessResponse {
  givenOut: {
    byType: Record<string, { count: number; retailCents: number; actualCostCents: number }>;
    totalRetailCents: number;
    totalActualCostCents: number;
    redeemedRetailCents: number;
    outstandingRetailCents: number;
  };
  byStatus: Record<string, number>;
  roi: {
    recipients: number;
    recipientSpendCents: number;
    recipientAvgCents: number;
    otherCustomers: number;
    otherSpendCents: number;
    otherAvgCents: number;
    liftPct: number;
  };
  note: string;
}

// ── status badge colors ──────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  issued: 'bg-green-100 text-green-700',
  redeemed: 'bg-green-100 text-green-700',
  denied: 'bg-gray-100 text-gray-500',
};

// Counters we know how to phrase compactly. Anything else falls back to a
// generic "<value> <counter>" rendering so new counters still show up.
function counterLine(counters: Record<string, number>): string {
  if (!counters || Object.keys(counters).length === 0) return 'no activity yet';
  const parts: string[] = [];
  if (counters.studio_hours != null) parts.push(`${counters.studio_hours} studio hrs`);
  if (counters.band_hours != null) parts.push(`${counters.band_hours} band hrs`);
  if (counters.hours_run != null) parts.push(`${counters.hours_run} hrs run`);
  if (counters.dollars_spent != null) parts.push(`${formatCents(counters.dollars_spent)} spent`);
  if (counters.band_spend != null) parts.push(`${formatCents(counters.band_spend)} band spend`);
  if (counters.producer_revenue != null) parts.push(`${formatCents(counters.producer_revenue)} beats`);
  if (counters.media_revenue != null) parts.push(`${formatCents(counters.media_revenue)} media`);
  // Surface any remaining counters we didn't special-case.
  const known = new Set([
    'studio_hours', 'band_hours', 'hours_run', 'dollars_spent',
    'band_spend', 'producer_revenue', 'media_revenue',
  ]);
  for (const [k, v] of Object.entries(counters)) {
    if (known.has(k)) continue;
    parts.push(`${v} ${k.replace(/_/g, ' ')}`);
  }
  return parts.length ? parts.join(' · ') : 'no activity yet';
}

export default function RewardsManager() {
  const [tab, setTab] = useState<TabKey>('users');

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-0 border-b border-black/10 mb-6 overflow-x-auto">
        {([
          { key: 'users', label: 'All Users', icon: Gift },
          { key: 'launch', label: 'Launch / Backfill', icon: Rocket },
          { key: 'rules', label: 'Rules', icon: SlidersHorizontal },
          { key: 'business', label: 'Business', icon: BarChart3 },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 border-b-2 transition-colors flex-shrink-0 inline-flex items-center gap-1.5 ${
              tab === t.key
                ? 'border-accent text-black'
                : 'border-transparent text-black/40 hover:text-black/70'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'launch' && <LaunchTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'business' && <BusinessTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — All Users
// ─────────────────────────────────────────────────────────────────────────────
function UsersTab() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyGrant, setBusyGrant] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/rewards/overview');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load rewards overview');
        setData(null);
      } else {
        setError(null);
        setData(json as OverviewResponse);
      }
    } catch {
      setError('Network error loading rewards overview');
      setData(null);
    }
    setLoading(false);
  }, []);

  // Initial load is inlined as a promise chain (rather than calling
  // fetchOverview synchronously) so setState never runs synchronously in the
  // effect body — matches UserManager's mount-fetch pattern.
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/rewards/overview')
      .then((r) => r.json().then((json) => ({ ok: r.ok, json })))
      .then(({ ok, json }) => {
        if (!alive) return;
        if (!ok) {
          setError(json.error || 'Failed to load rewards overview');
          setData(null);
        } else {
          setError(null);
          setData(json as OverviewResponse);
        }
      })
      .catch(() => {
        if (!alive) return;
        setError('Network error loading rewards overview');
        setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function actOnGrant(grantId: string, action: 'approve' | 'deny') {
    setBusyGrant(grantId);
    try {
      const res = await fetch(`/api/admin/rewards/grants/${grantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        alert(json.error || `Failed to ${action} grant`);
      }
    } catch {
      alert(`Error trying to ${action} grant`);
    }
    setBusyGrant(null);
    fetchOverview();
  }

  // Backfill grants that are still awaiting approval, across all owners.
  const backfillPending: Grant[] = (data?.owners || []).flatMap((o) =>
    o.grants.filter((g) => g.source === 'backfill' && g.status === 'pending_approval'),
  );

  async function approveAllBackfill() {
    const count = backfillPending.length;
    if (count === 0) return;
    if (!confirm(`Approve ${count} backfill grant${count === 1 ? '' : 's'} awaiting approval? This issues each one to its owner.`)) return;
    setBulkRunning(true);
    for (const g of backfillPending) {
      try {
        await fetch(`/api/admin/rewards/grants/${g.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve' }),
        });
      } catch {
        // Keep going — a single failure shouldn't abort the whole batch.
      }
    }
    setBulkRunning(false);
    fetchOverview();
  }

  if (loading) {
    return <p className="font-mono text-sm text-black/40">Loading rewards…</p>;
  }
  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50/40 p-4">
        <p className="font-mono text-xs text-red-600 uppercase tracking-wider font-bold mb-1">Error</p>
        <p className="font-mono text-sm text-red-700">{error}</p>
        <button
          onClick={fetchOverview}
          className="mt-3 border border-black/20 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-black/5"
        >
          Retry
        </button>
      </div>
    );
  }

  const summary = data?.summary;
  const owners = data?.owners || [];

  return (
    <div>
      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Owners', value: summary?.owners ?? 0, icon: Users },
          { label: 'Pending Approval', value: summary?.pending ?? 0, icon: Clock },
          { label: 'Pending Value', value: formatCents(summary?.pendingValueCents ?? 0), icon: DollarSign },
          { label: 'Issued', value: summary?.issued ?? 0, icon: Check },
        ].map((s) => (
          <div key={s.label} className="border border-black/10 p-4">
            <s.icon className="w-4 h-4 text-accent mb-2" />
            <p className="font-heading text-xl">{s.value}</p>
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={fetchOverview}
          className="p-2 border border-black/20 hover:border-black transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="font-mono text-xs text-black/60">{owners.length} owners</span>
        {backfillPending.length > 0 && (
          <button
            onClick={approveAllBackfill}
            disabled={bulkRunning}
            className="ml-auto bg-green-600 text-white font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Check className="w-3 h-3" />
            {bulkRunning ? 'Approving…' : `Approve all backfill (${backfillPending.length})`}
          </button>
        )}
      </div>

      {/* Owner list */}
      {owners.length === 0 ? (
        <p className="font-mono text-sm text-black/30 text-center py-8">No reward owners yet.</p>
      ) : (
        <div className="space-y-2">
          {owners.map((o) => {
            const isOpen = expanded === o.key;
            return (
              <div
                key={o.key}
                className={`border-2 transition-colors ${
                  o.pending > 0 ? 'border-amber-300 bg-amber-50/20' : 'border-black/10 hover:border-black/20'
                }`}
              >
                {/* Summary row */}
                <button
                  onClick={() => setExpanded(isOpen ? null : o.key)}
                  className="w-full p-4 text-left flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold truncate">{o.name}</span>
                      {o.kind === 'band' && (
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-accent text-black">
                          Band
                        </span>
                      )}
                      {o.pending > 0 && (
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-200 text-amber-800">
                          {o.pending} pending
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-black/50 truncate mt-1">{o.email || 'No email'}</p>
                    <p className="font-mono text-[11px] text-black/60 mt-0.5">{counterLine(o.counters)}</p>
                  </div>
                  <div className="text-right flex-shrink-0 font-mono text-[10px] text-black/50">
                    {o.issued > 0 && <p className="text-green-600 font-bold">{o.issued} issued</p>}
                    {o.approved > 0 && <p className="text-blue-600">{o.approved} approved</p>}
                    {o.denied > 0 && <p className="text-black/40">{o.denied} denied</p>}
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-black/30 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Expanded grants */}
                {isOpen && (
                  <div className="border-t border-black/10 p-4 space-y-2">
                    {o.grants.length === 0 ? (
                      <p className="font-mono text-xs text-black/40">No grants for this owner.</p>
                    ) : (
                      o.grants.map((g) => (
                        <div
                          key={g.id}
                          className="border border-black/10 p-3 flex items-start gap-3 flex-wrap"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                                  STATUS_BADGE[g.status] || 'bg-black/5 text-black/70'
                                }`}
                              >
                                {g.status.replace(/_/g, ' ')}
                              </span>
                              <span className="font-mono text-xs font-semibold">{g.label}</span>
                              {g.source === 'backfill' && (
                                <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-black/5 text-black/50">
                                  backfill
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-[10px] text-black/50 mt-1">
                              {g.counter.replace(/_/g, ' ')}: {g.counter_value} / {g.threshold}
                              {g.period_key ? ` · ${g.period_key}` : ''}
                              {g.value_cents > 0 ? ` · worth ${formatCents(g.value_cents)}` : ''}
                              {` · ${g.issuance}`}
                            </p>
                          </div>
                          {g.status === 'pending_approval' && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => actOnGrant(g.id, 'approve')}
                                disabled={busyGrant === g.id}
                                className="bg-green-600 text-white font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                <Check className="w-3 h-3" /> Approve
                              </button>
                              <button
                                onClick={() => actOnGrant(g.id, 'deny')}
                                disabled={busyGrant === g.id}
                                className="border border-red-300 text-red-600 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                <X className="w-3 h-3" /> Deny
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — Launch / Backfill
// ─────────────────────────────────────────────────────────────────────────────
function LaunchTab() {
  const [report, setReport] = useState<RecomputeReport | null>(null);
  const [seeded, setSeeded] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insertedNote, setInsertedNote] = useState<string | null>(null);

  async function recompute(apply: boolean) {
    setError(null);
    setInsertedNote(null);
    if (apply) setApplying(true);
    else setRunning(true);
    try {
      const res = await fetch('/api/admin/rewards/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply }),
      });
      const json: RecomputeResponse & { error?: string } = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || 'Recompute failed');
      } else {
        setReport(json.report);
        setSeeded(json.seeded);
        if (apply) {
          setInsertedNote(`Inserted ${json.report.grantsInserted} grant${json.report.grantsInserted === 1 ? '' : 's'}.`);
        }
      }
    } catch {
      setError('Network error during recompute');
    }
    setRunning(false);
    setApplying(false);
  }

  function runApply() {
    if (!confirm('Apply backfill? This SEEDS the reward rules and WRITES grants to the database. Free-work grants land pending for approval. Proceed?')) return;
    recompute(true);
  }

  const byType = report?.exposure?.byType || {};
  const typeRows = Object.entries(byType);

  return (
    <div>
      {/* Explanatory copy */}
      <div className="border-2 border-black/10 p-4 mb-6">
        <p className="font-mono text-xs font-bold uppercase tracking-wider mb-2 inline-flex items-center gap-1.5">
          <Rocket className="w-3.5 h-3.5 text-accent" /> Backfill the rewards engine
        </p>
        <p className="font-mono text-[11px] text-black/60 leading-relaxed">
          The dry run is read-only — it scans every customer and band, finds the grants they&apos;ve already
          earned, and projects the financial exposure by reward type. Nothing is written. When you&apos;re
          ready, <b>Apply backfill</b> seeds the reward rules into the database and writes the grants.
          Free-work grants (free hours, videos, photo sessions) land <b>pending for approval</b> — they
          will not be issued until you approve them on the <b>All Users</b> tab.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={() => recompute(false)}
          disabled={running || applying}
          className="border-2 border-black text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black hover:text-white transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Running…' : 'Run dry-run (read-only)'}
        </button>
        <button
          onClick={runApply}
          disabled={applying || running}
          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent/80 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Rocket className="w-3.5 h-3.5" />
          {applying ? 'Applying…' : 'Apply backfill (writes grants)'}
        </button>
        {insertedNote && (
          <span className="font-mono text-xs text-green-600 font-bold inline-flex items-center gap-1">
            <Check className="w-3 h-3" /> {insertedNote}
          </span>
        )}
      </div>

      {error && (
        <div className="border-2 border-red-300 bg-red-50/40 p-4 mb-6">
          <p className="font-mono text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="space-y-6">
          {/* Top-line counts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: report.dryRun ? 'Mode' : 'Mode', value: report.dryRun ? 'Dry run' : 'Applied' },
              { label: 'Customers', value: report.customers },
              { label: 'Bands', value: report.bands },
              { label: report.dryRun ? 'Grants Found' : 'Grants Inserted', value: report.dryRun ? report.grantsFound : report.grantsInserted },
            ].map((s) => (
              <div key={s.label} className="border border-black/10 p-4">
                <p className="font-heading text-xl">{s.value}</p>
                <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>

          {seeded === false && (
            <div className="border-2 border-amber-300 bg-amber-50/40 p-3 inline-flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="font-mono text-[11px] text-amber-800">
                Rules are not seeded yet. Run <b>Apply backfill</b> to seed them before editing on the Rules tab.
              </p>
            </div>
          )}

          {/* Exposure by type */}
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-wider mb-2">Projected exposure by reward type</p>
            {typeRows.length === 0 ? (
              <p className="font-mono text-xs text-black/40">No exposure projected.</p>
            ) : (
              <div className="border-2 border-black/10 overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-black/10 text-left text-black/60 uppercase tracking-wider text-[10px]">
                      <th className="px-3 py-2 font-bold">Reward Type</th>
                      <th className="px-3 py-2 font-bold text-right">Count</th>
                      <th className="px-3 py-2 font-bold text-right">Est. Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeRows.map(([type, info]) => (
                      <tr key={type} className="border-b border-black/5 last:border-0">
                        <td className="px-3 py-2">{type.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-right">{info.count}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCents(info.estCents)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-black/10 font-bold bg-black/[0.02]">
                      <td className="px-3 py-2 uppercase tracking-wider text-[10px]">Total Est. Exposure</td>
                      <td className="px-3 py-2 text-right">
                        {typeRows.reduce((sum, [, i]) => sum + i.count, 0)}
                      </td>
                      <td className="px-3 py-2 text-right text-accent">{formatCents(report.exposure.totalEstCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sample */}
          {report.sample.length > 0 && (
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-wider mb-2">Sample grants</p>
              <div className="space-y-1">
                {report.sample.map((s, i) => (
                  <div
                    key={i}
                    className="border border-black/10 px-3 py-2 font-mono text-[11px] flex items-center justify-between gap-3"
                  >
                    <span className="truncate">
                      <b>{s.owner}</b> · {s.label}
                    </span>
                    <span className="text-black/50 flex-shrink-0">
                      {s.counter_value} · {s.period}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — Rules
// ─────────────────────────────────────────────────────────────────────────────
function RulesTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [seeded, setSeeded] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Local per-row edit buffers, keyed by rule_key (rules may have null id until seeded).
  const [edits, setEdits] = useState<Record<string, Partial<Rule>>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/rewards/rules');
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || 'Failed to load rules');
      } else {
        setRules(json.rules || []);
        setSeeded(Boolean(json.seeded));
        setEdits({});
      }
    } catch {
      setError('Network error loading rules');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  function setEdit(key: string, patch: Partial<Rule>) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function valueFor<K extends keyof Rule>(rule: Rule, field: K): Rule[K] {
    const e = edits[rule.rule_key];
    if (e && field in e && e[field] !== undefined) return e[field] as Rule[K];
    return rule[field];
  }

  async function saveRule(rule: Rule) {
    if (rule.id == null) return;
    const e = edits[rule.rule_key] || {};
    setSavingKey(rule.rule_key);
    try {
      const res = await fetch('/api/admin/rewards/rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rule.id,
          threshold: valueFor(rule, 'threshold'),
          reward_value: valueFor(rule, 'reward_value'),
          issuance: valueFor(rule, 'issuance'),
          active: valueFor(rule, 'active'),
          ...(e.stack_mode !== undefined ? { stack_mode: e.stack_mode } : {}),
          ...(e.expires_days !== undefined ? { expires_days: e.expires_days } : {}),
          ...(e.label !== undefined ? { label: e.label } : {}),
          ...(e.sort_order !== undefined ? { sort_order: e.sort_order } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        alert(json.error || 'Failed to save rule');
      }
    } catch {
      alert('Error saving rule');
    }
    setSavingKey(null);
    fetchRules();
  }

  if (loading) {
    return <p className="font-mono text-sm text-black/40">Loading rules…</p>;
  }
  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50/40 p-4">
        <p className="font-mono text-sm text-red-700">{error}</p>
        <button
          onClick={fetchRules}
          className="mt-3 border border-black/20 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-black/5"
        >
          Retry
        </button>
      </div>
    );
  }

  // Group rules by track, preserving incoming order.
  const groups: Record<string, Rule[]> = {};
  for (const r of rules) {
    (groups[r.track] ||= []).push(r);
  }
  const trackKeys = Object.keys(groups);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={fetchRules}
          className="p-2 border border-black/20 hover:border-black transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="font-mono text-xs text-black/60">{rules.length} rules</span>
      </div>

      {!seeded && (
        <div className="border-2 border-amber-300 bg-amber-50/40 p-4 mb-6 inline-flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-amber-800 leading-relaxed">
            Seed the rules first (run <b>Apply backfill</b> on the Launch tab). Until then these are the
            code defaults, shown read-only.
          </p>
        </div>
      )}

      {trackKeys.length === 0 ? (
        <p className="font-mono text-sm text-black/30 text-center py-8">No rules defined.</p>
      ) : (
        <div className="space-y-8">
          {trackKeys.map((track) => (
            <div key={track}>
              <p className="font-mono text-xs font-bold uppercase tracking-wider mb-2 text-accent">
                {track.replace(/_/g, ' ')}
              </p>
              <div className="border-2 border-black/10 overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-black/10 text-left text-black/60 uppercase tracking-wider text-[10px]">
                      <th className="px-3 py-2 font-bold">Rule</th>
                      <th className="px-3 py-2 font-bold text-right">Threshold</th>
                      <th className="px-3 py-2 font-bold text-right">Reward</th>
                      <th className="px-3 py-2 font-bold">Issuance</th>
                      <th className="px-3 py-2 font-bold text-center">Active</th>
                      {seeded && <th className="px-3 py-2 font-bold text-right">Save</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {groups[track].map((rule) => {
                      const dirty = Boolean(edits[rule.rule_key]) && rule.id != null;
                      return (
                        <tr key={rule.rule_key} className="border-b border-black/5 last:border-0 align-top">
                          <td className="px-3 py-2 max-w-[260px]">
                            <p className="font-semibold leading-snug">{rule.label}</p>
                            <p className="text-[10px] text-black/40 mt-0.5">
                              {rule.counter.replace(/_/g, ' ')} · {rule.window.replace(/_/g, ' ')} · {rule.reward_type.replace(/_/g, ' ')}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {seeded ? (
                              <input
                                type="number"
                                value={valueFor(rule, 'threshold')}
                                onChange={(e) => setEdit(rule.rule_key, { threshold: Number(e.target.value) })}
                                className="w-24 border border-black/20 px-2 py-1 font-mono text-xs text-right focus:border-accent focus:outline-none"
                              />
                            ) : (
                              <span>{rule.threshold}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {seeded ? (
                              <input
                                type="number"
                                value={valueFor(rule, 'reward_value')}
                                onChange={(e) => setEdit(rule.rule_key, { reward_value: Number(e.target.value) })}
                                className="w-24 border border-black/20 px-2 py-1 font-mono text-xs text-right focus:border-accent focus:outline-none"
                              />
                            ) : (
                              <span>{rule.reward_value}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {seeded ? (
                              <select
                                value={valueFor(rule, 'issuance')}
                                onChange={(e) => setEdit(rule.rule_key, { issuance: e.target.value as 'auto' | 'approval' })}
                                className="border border-black/20 px-2 py-1 font-mono text-xs focus:border-accent focus:outline-none bg-white"
                              >
                                <option value="auto">auto</option>
                                <option value="approval">approval</option>
                              </select>
                            ) : (
                              <span>{rule.issuance}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {seeded ? (
                              <input
                                type="checkbox"
                                checked={Boolean(valueFor(rule, 'active'))}
                                onChange={(e) => setEdit(rule.rule_key, { active: e.target.checked })}
                                className="w-4 h-4 accent-[#F4C430]"
                              />
                            ) : (
                              <span>{rule.active ? 'yes' : 'no'}</span>
                            )}
                          </td>
                          {seeded && (
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => saveRule(rule)}
                                disabled={!dirty || savingKey === rule.rule_key}
                                className="bg-black text-white font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                {savingKey === rule.rule_key ? 'Saving…' : 'Save'}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — Business (rewards ROI / give-away tracking)
// ─────────────────────────────────────────────────────────────────────────────

// Color-coded status labels. issued/redeemed read as "real value out the door"
// (green), pending_approval is a decision waiting (amber), approved is committed
// but not yet redeemed (blue), baseline/denied are inert (gray).
const BUSINESS_STATUS_COLOR: Record<string, string> = {
  issued: 'text-green-700',
  redeemed: 'text-green-700',
  approved: 'text-blue-700',
  pending_approval: 'text-amber-700',
  baseline: 'text-black/40',
  denied: 'text-black/40',
};

function BusinessTab() {
  const [data, setData] = useState<BusinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBusiness = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/rewards/business');
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || 'Failed to load business view');
        setData(null);
      } else {
        setError(null);
        setData(json as BusinessResponse);
      }
    } catch {
      setError('Network error loading business view');
      setData(null);
    }
    setLoading(false);
  }, []);

  // Initial load inlined as a promise chain so setState never runs synchronously
  // in the effect body — matches the UsersTab mount-fetch pattern.
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/rewards/business')
      .then((r) => r.json().then((json) => ({ ok: r.ok, json })))
      .then(({ ok, json }) => {
        if (!alive) return;
        if (!ok || json.error) {
          setError(json.error || 'Failed to load business view');
          setData(null);
        } else {
          setError(null);
          setData(json as BusinessResponse);
        }
      })
      .catch(() => {
        if (!alive) return;
        setError('Network error loading business view');
        setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return <p className="font-mono text-sm text-black/40">Loading business view…</p>;
  }
  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50/40 p-4">
        <p className="font-mono text-xs text-red-600 uppercase tracking-wider font-bold mb-1">Error</p>
        <p className="font-mono text-sm text-red-700">{error}</p>
        <button
          onClick={fetchBusiness}
          className="mt-3 border border-black/20 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-black/5"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data) {
    return <p className="font-mono text-sm text-black/30 text-center py-8">No business data available.</p>;
  }

  const { givenOut, byStatus, roi, note } = data;
  const typeRows = Object.entries(givenOut.byType || {});
  const statusRows = Object.entries(byStatus || {});
  const nothingIssued = typeRows.length === 0 && givenOut.totalRetailCents === 0;
  const liftPositive = roi.liftPct >= 0;
  const noRoi = roi.recipients === 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={fetchBusiness}
          className="p-2 border border-black/20 hover:border-black transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="font-mono text-xs text-black/60">Rewards ROI &amp; give-away tracking</span>
      </div>

      {nothingIssued ? (
        <p className="font-mono text-sm text-black/30 text-center py-8">
          No rewards issued yet — this fills in after launch.
        </p>
      ) : (
        <div className="space-y-10">
          {/* ── Section 1: Given out ─────────────────────────────────────── */}
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
              <Gift className="w-3.5 h-3.5 text-accent" /> Given out
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {[
                {
                  label: 'Total retail value given',
                  value: formatCents(givenOut.totalRetailCents),
                  icon: Gift,
                  hint: 'Issued + redeemed + approved',
                },
                {
                  label: 'Cost to us (cash)',
                  value: formatCents(givenOut.totalActualCostCents),
                  icon: TrendingDown,
                  hint: 'Staff pay on comped work + bonuses',
                },
                {
                  label: 'Outstanding liability',
                  value: formatCents(givenOut.outstandingRetailCents),
                  icon: PiggyBank,
                  hint: 'Owed but not yet redeemed',
                },
              ].map((s) => (
                <div key={s.label} className="border-2 border-black/10 p-4">
                  <s.icon className="w-4 h-4 text-accent mb-2" />
                  <p className="font-heading text-2xl">{s.value}</p>
                  <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mt-1">{s.label}</p>
                  <p className="font-mono text-[10px] text-black/40 mt-0.5">{s.hint}</p>
                </div>
              ))}
            </div>

            {typeRows.length === 0 ? (
              <p className="font-mono text-xs text-black/40">No rewards given out by type yet.</p>
            ) : (
              <div className="border-2 border-black/10 overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-black/10 text-left text-black/60 uppercase tracking-wider text-[10px]">
                      <th className="px-3 py-2 font-bold">Reward Type</th>
                      <th className="px-3 py-2 font-bold text-right">Count</th>
                      <th className="px-3 py-2 font-bold text-right">Retail Value</th>
                      <th className="px-3 py-2 font-bold text-right">Cost to Us</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeRows.map(([type, info]) => (
                      <tr key={type} className="border-b border-black/5 last:border-0">
                        <td className="px-3 py-2">{type.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-right">{info.count}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCents(info.retailCents)}</td>
                        <td className="px-3 py-2 text-right text-black/60">{formatCents(info.actualCostCents)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-black/10 font-bold bg-black/[0.02]">
                      <td className="px-3 py-2 uppercase tracking-wider text-[10px]">Total</td>
                      <td className="px-3 py-2 text-right">
                        {typeRows.reduce((sum, [, i]) => sum + i.count, 0)}
                      </td>
                      <td className="px-3 py-2 text-right text-accent">{formatCents(givenOut.totalRetailCents)}</td>
                      <td className="px-3 py-2 text-right">{formatCents(givenOut.totalActualCostCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Section 2: By status ─────────────────────────────────────── */}
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-accent" /> By status
            </p>
            {statusRows.length === 0 ? (
              <p className="font-mono text-xs text-black/40">No grants on record yet.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {statusRows.map(([status, count]) => (
                  <div key={status} className="border-2 border-black/10 px-4 py-3 min-w-[120px]">
                    <p className={`font-heading text-xl ${BUSINESS_STATUS_COLOR[status] || 'text-black/70'}`}>
                      {count}
                    </p>
                    <p
                      className={`font-mono text-[10px] uppercase tracking-wider mt-0.5 ${
                        BUSINESS_STATUS_COLOR[status] || 'text-black/60'
                      }`}
                    >
                      {status.replace(/_/g, ' ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Section 3: ROI ───────────────────────────────────────────── */}
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-accent" /> ROI — are rewards driving revenue?
            </p>

            {noRoi ? (
              <p className="font-mono text-xs text-black/40">
                No rewards issued yet — this fills in after launch.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="border-2 border-black/10 p-4">
                    <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">
                      Reward recipients
                    </p>
                    <p className="font-heading text-2xl">{roi.recipients}</p>
                    <p className="font-mono text-[11px] text-black/60 mt-1">
                      {formatCents(roi.recipientAvgCents)} avg spend
                    </p>
                  </div>
                  <div className="border-2 border-black/10 p-4">
                    <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">
                      Other customers
                    </p>
                    <p className="font-heading text-2xl">{roi.otherCustomers}</p>
                    <p className="font-mono text-[11px] text-black/60 mt-1">
                      {formatCents(roi.otherAvgCents)} avg spend
                    </p>
                  </div>
                </div>

                {/* Prominent lift line */}
                <div
                  className={`border-2 p-4 inline-flex items-start gap-2 ${
                    liftPositive ? 'border-green-300 bg-green-50/40' : 'border-red-300 bg-red-50/40'
                  }`}
                >
                  {liftPositive ? (
                    <TrendingUp className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  )}
                  <p
                    className={`font-mono text-sm font-bold ${
                      liftPositive ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    Reward recipients spend {Math.abs(roi.liftPct)}% {liftPositive ? 'more' : 'less'} on average
                  </p>
                </div>
              </>
            )}

            {note && <p className="font-mono text-[11px] text-black/40 mt-3 leading-relaxed">{note}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
