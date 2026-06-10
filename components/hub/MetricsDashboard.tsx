'use client';

import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Save, Loader2, Link2, Unlink, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { METRIC_PLATFORMS, METRIC_FIELD_LABELS } from '@/lib/hub-constants';
import { getPlatformLevel, getPlatformLevelTitle } from '@/lib/xp-system';
import { SkeletonChart } from './LoadingSkeleton';
import MetricsChart, { Sparkline, calculateGrowthRate } from './MetricsChart';
import type { DataPoint, ChartSeries } from './MetricsChart';

interface Metric {
  id: string;
  platform: string;
  metric_date: string;
  followers: number | null;
  streams: number | null;
  engagement_rate: number | null;
  monthly_listeners: number | null;
  subscribers: number | null;
  saves: number | null;
  playlist_adds: number | null;
  popularity_score: number | null;
  plays: number | null;
  shazams: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  reels_views: number | null;
  posts_count: number | null;
  total_likes: number | null;
  avg_views: number | null;
  videos_count: number | null;
  total_views: number | null;
  watch_hours: number | null;
  reposts: number | null;
  comments: number | null;
  impressions: number | null;
  source: string | null;
  [key: string]: string | number | null | undefined;
}

interface PlatformConnection {
  id: string;
  platform: string;
  platform_id: string | null;
  platform_url: string | null;
  display_name: string | null;
  profile_image_url: string | null;
  auto_fetch_enabled: boolean;
  last_fetched_at: string | null;
  fetch_error: string | null;
}

export default function MetricsDashboard({ onXpEarned }: { onXpEarned?: () => void }) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activePlatform, setActivePlatform] = useState<string>('all');

  // Log form state
  const [showLogForm, setShowLogForm] = useState(false);
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0]);
  const [logEntries, setLogEntries] = useState<Record<string, Record<string, string>>>({});

  // Connect form state
  const [showConnectForm, setShowConnectForm] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  // Weekly tracking program state (agent console): paused = has links but no
  // paid activity in 90 days. Best-effort — the tab works fine without it.
  const [tracking, setTracking] = useState<{ paused: boolean } | null>(null);

  const loadData = useCallback(async () => {
    const [metricsRes, connectionsRes, trackingRes] = await Promise.all([
      fetch('/api/hub/metrics?days=90'),
      fetch('/api/hub/connections'),
      fetch('/api/hub/tracking-status'),
    ]);
    const metricsData = await metricsRes.json();
    const connectionsData = await connectionsRes.json();
    setMetrics(metricsData.metrics || []);
    setConnections(connectionsData.connections || []);
    try {
      const t = await trackingRes.json();
      if (trackingRes.ok) setTracking({ paused: !!t.paused });
    } catch { /* banner is optional */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveMetrics() {
    setSaving(true);
    const entries = Object.entries(logEntries)
      .filter(([, fields]) => Object.values(fields).some((v) => v.trim()))
      .map(([platform, fields]) => {
        const entry: Record<string, unknown> = { platform, metric_date: logDate };
        // Map all fields dynamically
        for (const [key, val] of Object.entries(fields)) {
          if (val.trim()) {
            entry[key] = key === 'engagement_rate' || key === 'watch_hours'
              ? parseFloat(val)
              : parseInt(val);
          }
        }
        return entry;
      });

    if (entries.length > 0) {
      await fetch('/api/hub/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });

      try {
        await fetch('/api/hub/xp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'log_metrics' }),
        });
        onXpEarned?.();
      } catch { /* XP award non-critical */ }

      await loadData();
    }
    setSaving(false);
    setShowLogForm(false);
    setLogEntries({});
  }

  function updateLogEntry(platform: string, field: string, value: string) {
    setLogEntries((prev) => ({
      ...prev,
      [platform]: { ...(prev[platform] || {}), [field]: value },
    }));
  }

  async function connectPlatform(platform: string) {
    setConnecting(true);
    setConnectError(null);
    setConnectSuccess(null);

    const res = await fetch('/api/hub/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, url: connectUrl }),
    });

    const data = await res.json();
    if (!res.ok) {
      setConnectError(data.error);
    } else {
      setConnectSuccess(data.verified ? `Connected as ${data.connection.display_name}` : 'Profile URL saved');
      setConnectUrl('');
      setShowConnectForm(null);
      await loadData();
    }
    setConnecting(false);
  }

  async function disconnectPlatform(platform: string) {
    await fetch(`/api/hub/connections?platform=${platform}`, { method: 'DELETE' });
    await loadData();
  }

  // Get latest per platform for snapshot
  const latestByPlatform: Record<string, Metric> = {};
  const previousByPlatform: Record<string, Metric> = {};
  for (const m of [...metrics].reverse()) {
    if (!latestByPlatform[m.platform]) latestByPlatform[m.platform] = m;
    else if (!previousByPlatform[m.platform]) previousByPlatform[m.platform] = m;
  }

  const connectionsByPlatform: Record<string, PlatformConnection> = {};
  for (const c of connections) connectionsByPlatform[c.platform] = c;

  // Filter metrics for chart
  const chartMetrics = activePlatform === 'all' ? metrics : metrics.filter((m) => m.platform === activePlatform);

  // Build DataPoint arrays for chart components
  function buildDataPoints(data: Metric[], field: string): DataPoint[] {
    return data
      .filter((d) => ((d[field] as number) || 0) > 0)
      .map((d) => ({ date: d.metric_date, value: (d[field] as number) || 0 }));
  }

  // Build chart series for a platform
  function buildChartSeries(platformKey: string, fields: string[], color: string): ChartSeries[] {
    const platformData = metrics.filter((m) => m.platform === platformKey);
    return fields
      .map((field) => ({
        label: METRIC_FIELD_LABELS[field] || field.replace(/_/g, ' '),
        data: buildDataPoints(platformData, field),
        color,
      }))
      .filter((s) => s.data.length >= 2);
  }

  function getDelta(current: number | null, previous: number | null): { text: string; value: number; positive: boolean } | null {
    if (!current || !previous || previous === 0) return null;
    const diff = current - previous;
    const pct = Math.round((diff / previous) * 100);
    return { text: `${pct > 0 ? '+' : ''}${pct}%`, value: diff, positive: pct >= 0 };
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-heading-md">METRICS</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonChart key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-heading-md">METRICS</h2>
      </div>

      {/* The pitch: artists supply LINKS, the platform supplies the numbers.
          Manual logging still exists but is demoted to a quiet fallback —
          manual rows never count toward charts (verified data only). */}
      <div className="border-2 border-accent/60 bg-accent/5 px-4 py-3 mb-4">
        <p className="font-mono text-xs text-black/80">
          <span className="font-bold uppercase tracking-wider">Add your profile links below</span> — our
          team tracks your fans + followers from your links every week. Apple Music is the one
          exception — its numbers live in your own artist dashboard, so you log those yourself.
        </p>
        <button onClick={() => setShowLogForm(!showLogForm)}
          className="font-mono text-[10px] text-black/40 underline hover:text-black mt-1.5">
          {showLogForm ? 'Close Apple Music logging' : 'Log your Apple Music numbers'}
        </button>
      </div>

      {/* Tracking paused — win-back, resumes automatically on the next payment. */}
      {tracking?.paused && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 px-4 py-3 mb-4">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="font-mono text-xs text-amber-800">
            Your weekly stat tracking is paused. Book any session or make a purchase and it resumes
            automatically — your history stays put.
          </span>
        </div>
      )}

      {/* Success/error banners */}
      {connectSuccess && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-4 py-3 mb-4 transition-all duration-300">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span className="font-mono text-xs text-green-800">{connectSuccess}</span>
          <button onClick={() => setConnectSuccess(null)} className="ml-auto font-mono text-xs text-green-600 hover:text-green-800">✕</button>
        </div>
      )}

      {/* Log form */}
      {showLogForm && (
        <div className="border-2 border-accent p-6 mb-8 space-y-4 transition-all duration-300">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-sm font-bold uppercase tracking-wider">Log Apple Music</h3>
            <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)}
              className="border border-black/20 px-2 py-1 font-mono text-xs focus:border-accent focus:outline-none" />
          </div>
          <div className="space-y-4">
            {/* Apple Music ONLY — every other platform is tracked from the
                artist's pasted link (API sync or the weekly agent run). */}
            {METRIC_PLATFORMS.filter((p) => p.key === 'apple_music').map((platform) => (
              <div key={platform.key} className="border border-black/10 p-3 transition-colors duration-200 hover:border-black/20">
                <p className="font-mono text-xs font-bold uppercase tracking-wider mb-2" style={{ color: platform.color }}>
                  {platform.icon} {platform.label}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {platform.fields.map((field) => (
                    <div key={field}>
                      <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider">
                        {METRIC_FIELD_LABELS[field] || field.replace(/_/g, ' ')}
                      </label>
                      <input
                        type="number"
                        step={(field as string) === 'engagement_rate' || (field as string) === 'watch_hours' ? '0.01' : '1'}
                        value={logEntries[platform.key]?.[field] || ''}
                        onChange={(e) => updateLogEntry(platform.key, field, e.target.value)}
                        className="w-full border border-black/10 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button onClick={saveMetrics} disabled={saving}
            className="bg-black text-white font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-black/80 disabled:opacity-50 transition-colors inline-flex items-center gap-2">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save All</>}
          </button>
        </div>
      )}

      {/* Platform tabs */}
      <div className="flex gap-0 border-b border-black/10 mb-6 overflow-x-auto">
        <button onClick={() => setActivePlatform('all')}
          className={`font-mono text-xs uppercase tracking-wider px-4 py-3 border-b-2 transition-all duration-200 flex-shrink-0 ${
            activePlatform === 'all' ? 'border-accent text-black font-bold' : 'border-transparent text-black/40 hover:text-black/60'
          }`}>All</button>
        {METRIC_PLATFORMS.map((p) => (
          <button key={p.key} onClick={() => setActivePlatform(p.key)}
            className={`font-mono text-xs uppercase tracking-wider px-4 py-3 border-b-2 transition-all duration-200 flex-shrink-0 ${
              activePlatform === p.key ? 'border-accent text-black font-bold' : 'border-transparent text-black/40 hover:text-black/60'
            }`}>
            <span className="mr-1">{p.icon}</span>{p.label}
          </button>
        ))}
      </div>

      {/* Connected platforms status bar */}
      {connections.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {connections.map((conn) => {
            const plat = METRIC_PLATFORMS.find((p) => p.key === conn.platform);
            return (
              <div key={conn.id} className="inline-flex items-center gap-1.5 border border-black/10 px-3 py-1.5 transition-all duration-200 hover:border-black/20">
                {conn.profile_image_url && (
                  <img src={conn.profile_image_url} alt="" className="w-4 h-4 rounded-full" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: plat?.color }}>
                  {plat?.label}
                </span>
                {conn.display_name && (
                  <span className="font-mono text-[10px] text-black/50">{conn.display_name}</span>
                )}
                {conn.last_fetched_at && (
                  <span className="font-mono text-[10px] text-black/30">
                    updated {new Date(conn.last_fetched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {conn.auto_fetch_enabled && (
                  <RefreshCw className="w-3 h-3 text-green-500" />
                )}
                {conn.fetch_error && (
                  <span title={conn.fetch_error || ''}><AlertCircle className="w-3 h-3 text-red-400" /></span>
                )}
                <button onClick={() => disconnectPlatform(conn.platform)}
                  className="text-black/20 hover:text-red-500 transition-colors ml-1" title="Disconnect">
                  <Unlink className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Metrics snapshot cards — always rendered: with no data yet, every card
          shows its "Add your … link" CTA, which IS the empty-state onboarding. */}
      {(
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {METRIC_PLATFORMS.map((platform) => {
            const latest = latestByPlatform[platform.key];
            const prev = previousByPlatform[platform.key];
            const conn = connectionsByPlatform[platform.key];
            const isAutoFetchable = platform.autoFetchable;

            if (!latest) return (
              <div key={platform.key} className="border-2 border-black/5 p-4 transition-all duration-300 hover:border-black/10">
                <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: platform.color }}>
                  {platform.icon} {platform.label}
                </p>
                <p className="font-mono text-xs text-black/20 mb-3">No data</p>

                {/* Apple Music has no public page to read — its numbers are
                    self-logged. Every OTHER platform: paste a link (API sync
                    for spotify/youtube, weekly agent run for the rest). */}
                {platform.key === 'apple_music' ? (
                  <button onClick={() => setShowLogForm(true)}
                    className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent/80 transition-colors">
                    Log your Apple Music numbers
                  </button>
                ) : !conn && (
                  showConnectForm === platform.key ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={connectUrl}
                        onChange={(e) => { setConnectUrl(e.target.value); setConnectError(null); }}
                        placeholder={platform.key === 'spotify' ? 'Paste Spotify artist URL...' : platform.key === 'youtube' ? 'Paste YouTube channel URL...' : `Paste your ${platform.label} URL...`}
                        className="w-full border border-black/10 px-2 py-1.5 font-mono text-[10px] focus:border-accent focus:outline-none transition-colors"
                      />
                      {connectError && (
                        <p className="font-mono text-[10px] text-red-500">{connectError}</p>
                      )}
                      <div className="flex gap-1">
                        <button onClick={() => connectPlatform(platform.key)} disabled={connecting || !connectUrl.trim()}
                          className="bg-black text-white font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 hover:bg-black/80 disabled:opacity-30 transition-colors inline-flex items-center gap-1">
                          {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                          {isAutoFetchable ? 'Connect' : 'Save link'}
                        </button>
                        <button onClick={() => { setShowConnectForm(null); setConnectUrl(''); setConnectError(null); }}
                          className="font-mono text-[10px] text-black/40 px-2 py-1.5 hover:text-black transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setShowConnectForm(platform.key); setConnectUrl(''); setConnectError(null); }}
                      className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent/80 transition-colors inline-flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> {isAutoFetchable ? 'Auto-Connect' : `Add your ${platform.label} link`}
                    </button>
                  )
                )}
              </div>
            );

            const primaryField = platform.primaryField;
            const mainValue = (latest[primaryField] as number) || latest.followers || 0;
            const prevMainValue = prev ? ((prev[primaryField] as number) || prev.followers || 0) : 0;
            const delta = getDelta(mainValue, prevMainValue);
            const platformMetrics = metrics.filter((m) => m.platform === platform.key);

            // Platform level
            const platLevel = getPlatformLevel(mainValue);
            const platLevelTitle = getPlatformLevelTitle(platLevel.level);

            // Secondary fields with values
            const secondaryFields = platform.fields
              .filter((f) => f !== primaryField && latest[f] != null && (latest[f] as number) > 0)
              .slice(0, 3);

            return (
              <div key={platform.key} className="border-2 border-black/10 p-4 transition-all duration-300 hover:border-black/20 hover:shadow-sm">
                {/* Platform header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span>{platform.icon}</span>
                    <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: platform.color }}>{platform.label}</p>
                    {conn?.auto_fetch_enabled && <span title="Auto-syncing"><RefreshCw className="w-2.5 h-2.5 text-green-500" /></span>}
                  </div>
                  <span className="font-mono text-[10px] text-black/30 uppercase tracking-wider">Lv {platLevel.level}</span>
                </div>

                {/* Connect / save-link if not connected. Apple Music is the
                    self-logged exception (no public page to read). */}
                {platform.key === 'apple_music' ? (
                  <button onClick={() => setShowLogForm(true)}
                    className="font-mono text-[10px] text-accent/70 hover:text-accent transition-colors mb-2">
                    Log your Apple Music numbers
                  </button>
                ) : !conn && (
                  showConnectForm === platform.key ? (
                    <div className="space-y-2 mb-3">
                      <input
                        type="text"
                        value={connectUrl}
                        onChange={(e) => { setConnectUrl(e.target.value); setConnectError(null); }}
                        placeholder={platform.key === 'spotify' ? 'Spotify artist URL...' : platform.key === 'youtube' ? 'YouTube channel URL...' : `${platform.label} profile URL...`}
                        className="w-full border border-black/10 px-2 py-1.5 font-mono text-[10px] focus:border-accent focus:outline-none transition-colors"
                      />
                      {connectError && <p className="font-mono text-[10px] text-red-500">{connectError}</p>}
                      <div className="flex gap-1">
                        <button onClick={() => connectPlatform(platform.key)} disabled={connecting || !connectUrl.trim()}
                          className="bg-black text-white font-mono text-[10px] uppercase tracking-wider px-2 py-1 hover:bg-black/80 disabled:opacity-30 transition-colors inline-flex items-center gap-1">
                          {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                          {isAutoFetchable ? 'Connect' : 'Save link'}
                        </button>
                        <button onClick={() => { setShowConnectForm(null); setConnectUrl(''); setConnectError(null); }}
                          className="font-mono text-[10px] text-black/40 px-2 py-1 hover:text-black transition-colors">✕</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setShowConnectForm(platform.key); setConnectUrl(''); setConnectError(null); }}
                      className="font-mono text-[10px] text-accent/70 hover:text-accent transition-colors inline-flex items-center gap-1 mb-2">
                      <Link2 className="w-3 h-3" /> {isAutoFetchable ? 'Connect for auto-sync' : 'Add your link for weekly tracking'}
                    </button>
                  )
                )}

                {/* Main value */}
                <p className="text-heading-sm">{mainValue.toLocaleString()}</p>
                <p className="font-mono text-[10px] text-black/30 uppercase tracking-wider">
                  {METRIC_FIELD_LABELS[primaryField] || primaryField.replace(/_/g, ' ')}
                </p>

                {/* Week-over-week delta */}
                {delta && (
                  <div className={`font-mono text-[10px] inline-flex items-center gap-0.5 mt-0.5 ${delta.positive ? 'text-green-600' : 'text-red-500'}`}>
                    {delta.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    <span>{delta.text}</span>
                    <span className="text-black/30 ml-1">({delta.positive ? '+' : ''}{delta.value.toLocaleString()})</span>
                  </div>
                )}

                {/* Secondary metrics */}
                {secondaryFields.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {secondaryFields.map((field) => {
                      const val = latest[field] as number;
                      const prevVal = prev ? (prev[field] as number) : null;
                      const secDelta = getDelta(val, prevVal);
                      return (
                        <div key={field} className="flex items-center justify-between font-mono text-[10px]">
                          <span className="text-black/40">{METRIC_FIELD_LABELS[field] || field.replace(/_/g, ' ')}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-black/70">
                              {field === 'engagement_rate' ? `${val}%` : val.toLocaleString()}
                            </span>
                            {secDelta && (
                              <span className={secDelta.positive ? 'text-green-500' : 'text-red-400'}>{secDelta.text}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Platform level progress bar */}
                <div className="mt-3 mb-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] text-black/40 uppercase tracking-wider">{platLevelTitle}</span>
                    {platLevel.nextThreshold && (
                      <span className="font-mono text-[10px] text-black/25">{platLevel.progress}%</span>
                    )}
                  </div>
                  <div className="w-full h-1.5 bg-black/5 overflow-hidden">
                    <div
                      className="h-full transition-all duration-700 ease-out"
                      style={{ width: `${platLevel.progress}%`, backgroundColor: platform.color, opacity: 0.7 }}
                    />
                  </div>
                  {platLevel.nextThreshold && (
                    <p className="font-mono text-[10px] text-black/20 mt-0.5">
                      {platLevel.nextThreshold.toLocaleString()} for Lv {platLevel.level + 1}
                    </p>
                  )}
                </div>

                {/* Sparkline chart + 30-day growth */}
                <div className="mt-2">
                  {(() => {
                    const dataPoints = buildDataPoints(platformMetrics, primaryField);
                    const sparkValues = dataPoints.map((d) => d.value);
                    const growth = calculateGrowthRate(dataPoints, 30);
                    return (
                      <>
                        <Sparkline data={sparkValues} color={platform.color} width={200} height={32} className="w-full" />
                        {growth && (
                          <div className={`font-mono text-[10px] mt-1 ${growth.positive ? 'text-green-600' : 'text-red-500'}`}>
                            {growth.positive ? '+' : ''}{growth.percent}% last 30d
                            <span className="text-black/25 ml-1">({growth.positive ? '+' : ''}{growth.absolute.toLocaleString()})</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Last updated + source */}
                <div className="flex items-center justify-between mt-1">
                  <p className="font-mono text-[10px] text-black/30">{latest.metric_date}</p>
                  {latest.source && latest.source !== 'manual' && (
                    <span className="font-mono text-[10px] text-green-500/60 uppercase">auto</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expanded chart view when a specific platform is selected */}
      {activePlatform !== 'all' && chartMetrics.length >= 2 && (() => {
        const platform = METRIC_PLATFORMS.find((p) => p.key === activePlatform);
        if (!platform) return null;
        const latest = latestByPlatform[platform.key];
        if (!latest) return null;

        // Show expanded charts for all fields that have data
        const fieldsWithData = platform.fields.filter((f) =>
          chartMetrics.some((m) => (m[f] as number) > 0)
        );

        return (
          <div className="mt-6 border-2 border-black/10 p-6 transition-all duration-300">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-4">
              {platform.icon} {platform.label} — Detailed Charts
            </h3>
            <div className="space-y-8">
              {fieldsWithData.map((field) => {
                const dataPoints = buildDataPoints(chartMetrics, field);
                const growth = calculateGrowthRate(dataPoints, 30);
                const chartSeries: ChartSeries[] = [{
                  label: METRIC_FIELD_LABELS[field] || field.replace(/_/g, ' '),
                  data: dataPoints,
                  color: platform.color,
                }];
                return (
                  <div key={field}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-mono text-[10px] uppercase tracking-wider text-black/40">
                        {METRIC_FIELD_LABELS[field] || field.replace(/_/g, ' ')}
                      </h4>
                      {growth && (
                        <span className={`font-mono text-[10px] font-bold ${growth.positive ? 'text-green-600' : 'text-red-500'}`}>
                          {growth.positive ? '+' : ''}{growth.percent}% this month
                          <span className="text-black/25 font-normal ml-1">
                            ({growth.positive ? '+' : ''}{growth.absolute.toLocaleString()})
                          </span>
                        </span>
                      )}
                    </div>
                    <MetricsChart series={chartSeries} height={180} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Overview trend charts when "All" is selected */}
      {activePlatform === 'all' && metrics.length >= 2 && (
        <div className="mt-6 space-y-6">
          {METRIC_PLATFORMS.map((platform) => {
            const allSeries = buildChartSeries(platform.key, [platform.primaryField], platform.color);
            if (allSeries.length === 0) return null;
            const growth = calculateGrowthRate(allSeries[0].data, 30);
            return (
              <div key={platform.key} className="border-2 border-black/10 p-5 transition-all duration-300 hover:border-black/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span>{platform.icon}</span>
                    <h3 className="font-mono text-xs font-bold uppercase tracking-wider" style={{ color: platform.color }}>
                      {platform.label}
                    </h3>
                    <span className="font-mono text-[10px] text-black/30 uppercase">
                      {METRIC_FIELD_LABELS[platform.primaryField]}
                    </span>
                  </div>
                  {growth && (
                    <div className={`flex items-center gap-1 font-mono text-xs font-bold ${growth.positive ? 'text-green-600' : 'text-red-500'}`}>
                      {growth.positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {growth.positive ? '+' : ''}{growth.percent}%
                      <span className="text-black/25 font-normal text-[10px] ml-1">30d</span>
                    </div>
                  )}
                </div>
                <MetricsChart series={allSeries} height={160} showDots={false} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

}
