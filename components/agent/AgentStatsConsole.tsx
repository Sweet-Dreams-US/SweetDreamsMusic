'use client';

// AgentStatsConsole — Cowork's weekly stat-recording surface (/agent/stats).
//
// Queue screen: today's due artists (stable weekday slot + missed catch-ups).
// Work screen: one row per platform link — open the link, type the numbers,
// Save & Next. Anomalies (>50% swing vs the last verified snapshot) require an
// inline confirm and save flagged (held out of charts until reviewed).
//
// Design language mirrors RewardsManager: font-mono, uppercase tracking-wider
// labels, border-2 border-black/10 cards, accent for highlights, no UI libs.

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, ExternalLink, Check, AlertTriangle, Play, Flag,
  ChevronRight, Clock, Users, CircleCheck, SkipForward,
} from 'lucide-react';
import { AGENT_STATUSES, type AgentMetricColumn, type AgentStatus } from '@/lib/agent-stats';

interface QueueArtist {
  userId: string; name: string; email: string; photoUrl: string | null;
  connectionCount: number; lastAgentDate: string | null;
  slot: number; dueToday: boolean; missed: boolean; done: boolean;
}
interface Queue {
  dateStr: string; dayIdx: number; artists: QueueArtist[];
  stats: { due: number; done: number; remaining: number };
}
interface WorkPlatform {
  key: string; label: string;
  fields: { column: AgentMetricColumn; label: string }[];
  connection: { url: string | null; displayName: string | null; lastFetchedAt: string | null; fetchError: string | null } | null;
  lastAgent: { date: string; values: Partial<Record<AgentMetricColumn, number | null>>; anomaly: boolean } | null;
  prefill: { source: string; values: Partial<Record<AgentMetricColumn, number | null>> } | null;
}
interface ArtistWork {
  userId: string; name: string; email: string; photoUrl: string | null;
  isActive: boolean; lastPaidAt: string | null; lastAgentDate: string | null;
  platforms: WorkPlatform[];
}
interface RunRow {
  id: string; run_date: string; instance: string;
  artists_processed: number; platforms_recorded: number;
  blocked_count: number; skipped_count: number; anomaly_count: number;
  started_at: string; finished_at: string | null;
}
interface Anomaly { platform: string; column: AgentMetricColumn; previous: number; next: number; pctChange: number }

type PlatformForm = { status: AgentStatus; values: Record<string, string> };

const STATUS_LABELS: Record<AgentStatus, string> = {
  recorded: 'Recorded', blocked: 'Blocked', page_not_found: 'Page not found', skipped: 'Skipped',
};
const fmtNum = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));

export default function AgentStatsConsole() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [artist, setArtist] = useState<ArtistWork | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [form, setForm] = useState<Record<string, PlatformForm>>({});
  const [saving, setSaving] = useState(false);
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunRow | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, rRes] = await Promise.all([fetch('/api/agent/queue'), fetch('/api/agent/runs')]);
      const qJson = await qRes.json();
      const rJson = await rRes.json();
      if (!qRes.ok) { setError(qJson.error || 'Failed to load queue'); setQueue(null); }
      else {
        setError(null);
        setQueue(qJson as Queue);
        const open = ((rJson.runs ?? []) as RunRow[]).find((r) => !r.finished_at);
        if (open) setRun(open);
      }
    } catch { setError('Network error loading the queue'); setQueue(null); }
    setLoading(false);
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  async function ensureRun(): Promise<RunRow | null> {
    if (run) return run;
    try {
      const res = await fetch('/api/agent/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const json = await res.json();
      if (res.ok && json.run) { setRun(json.run as RunRow); return json.run as RunRow; }
    } catch { /* run tracking is best-effort — recording still works */ }
    return null;
  }

  async function openArtist(userId: string) {
    setArtistLoading(true); setAnomalies(null); setNotice(null); setSummary(null);
    try {
      const res = await fetch(`/api/agent/artist/${userId}`);
      const json = await res.json();
      if (!res.ok) { setNotice(json.error || 'Failed to load artist'); setArtistLoading(false); return; }
      const work = json as ArtistWork;
      const init: Record<string, PlatformForm> = {};
      for (const p of work.platforms) {
        if (!p.connection) continue;
        const values: Record<string, string> = {};
        for (const f of p.fields) {
          const pre = p.prefill?.values?.[f.column];
          values[f.column] = pre != null ? String(pre) : '';
        }
        init[p.key] = { status: 'recorded', values };
      }
      setForm(init);
      setArtist(work);
    } catch { setNotice('Network error loading artist'); }
    setArtistLoading(false);
  }

  function nextArtist(afterUserId: string) {
    const remaining = (queue?.artists ?? []).filter((a) => !a.done && a.userId !== afterUserId);
    setArtist(null);
    if (remaining.length > 0) openArtist(remaining[0].userId);
    loadQueue();
  }

  async function save(confirm: boolean) {
    if (!artist) return;
    setSaving(true); setNotice(null);
    const activeRun = await ensureRun();
    const entries = Object.entries(form).map(([platform, f]) => {
      const values: Record<string, number> = {};
      for (const [col, raw] of Object.entries(f.values)) {
        if (raw.trim() === '') continue;
        const n = Number(raw.replace(/[,\s]/g, ''));
        if (Number.isFinite(n) && n >= 0) values[col] = Math.round(n);
      }
      // "Recorded" with nothing typed is really a skip — never stamp a clean
      // fetch without data behind it.
      const status: AgentStatus =
        f.status === 'recorded' && Object.keys(values).length === 0 ? 'skipped' : f.status;
      return { platform, status, values };
    });

    try {
      const res = await fetch('/api/agent/metrics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: artist.userId, runId: activeRun?.id, entries, confirmAnomalies: confirm,
        }),
      });
      const json = await res.json();
      if (res.status === 409 && json.needsConfirmation) {
        setAnomalies(json.anomalies as Anomaly[]);
        setSaving(false);
        return;
      }
      if (!res.ok) { setNotice(json.error || 'Save failed'); setSaving(false); return; }
      setAnomalies(null);
      const rejected = (json.rejected ?? []) as { platform: string; reason: string; lastDate: string }[];
      if (rejected.length > 0) {
        setNotice(`Saved ${json.saved.length} platform(s). Rejected (already recorded this week): ${rejected.map((r) => r.platform).join(', ')}`);
      }
      nextArtist(artist.userId);
    } catch { setNotice('Network error saving'); }
    setSaving(false);
  }

  async function finishRun() {
    if (!run) return;
    if (!confirm('Finish today’s run? This closes the run and shows the summary for the end-of-day report.')) return;
    try {
      const res = await fetch('/api/agent/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finish', runId: run.id }),
      });
      const json = await res.json();
      if (res.ok && json.run) { setSummary(json.run as RunRow); setRun(null); setArtist(null); }
    } catch { /* leave the run open */ }
  }

  async function clearFlag(platform: string, metricDate: string) {
    if (!artist) return;
    try {
      const res = await fetch('/api/agent/anomaly', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: artist.userId, platform, metricDate }),
      });
      if (res.ok) openArtist(artist.userId); // re-pull so the badge drops
      else setNotice('Could not clear the flag');
    } catch { setNotice('Network error clearing the flag'); }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  // ORDER MATTERS: the work-screen branch must precede the queue-loading branch —
  // nextArtist() refreshes the queue in the background while the next artist
  // loads, and `if (loading)` first would flash "Loading queue…" mid-walk.

  if (artistLoading || (artist && !summary)) {
    // fall through to the work screen below
  } else if (loading) {
    return <p className="font-mono text-sm text-black/40">Loading queue…</p>;
  }
  if (!artist && !artistLoading && error) {
    return (
      <div className="border-2 border-red-300 bg-red-50/40 p-4">
        <p className="font-mono text-xs text-red-600 uppercase tracking-wider font-bold mb-1">Error</p>
        <p className="font-mono text-sm text-red-700">{error}</p>
        <button onClick={loadQueue} className="mt-3 border border-black/20 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-black/5">
          Retry
        </button>
      </div>
    );
  }

  // Run summary card (after Finish run).
  if (summary) {
    return (
      <div>
        <h2 className="text-heading-md mb-6 flex items-center gap-3"><Flag className="w-6 h-6 text-accent" /> RUN COMPLETE — {summary.run_date}</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Artists processed', value: summary.artists_processed },
            { label: 'Platforms recorded', value: summary.platforms_recorded },
            { label: 'Blocked / missing', value: summary.blocked_count },
            { label: 'Skipped', value: summary.skipped_count },
            { label: 'Anomalies flagged', value: summary.anomaly_count },
          ].map((s) => (
            <div key={s.label} className="border border-black/10 p-4">
              <p className="font-heading text-xl">{s.value}</p>
              <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="font-mono text-xs text-black/50 mb-4">Instance: {summary.instance} · started {new Date(summary.started_at).toLocaleTimeString('en-US')} · finished {summary.finished_at ? new Date(summary.finished_at).toLocaleTimeString('en-US') : '—'}</p>
        <button onClick={() => { setSummary(null); loadQueue(); }}
          className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-black/80">
          Back to queue
        </button>
      </div>
    );
  }

  // Work screen.
  if (artist || artistLoading) {
    if (artistLoading || !artist) return <p className="font-mono text-sm text-black/40">Loading artist…</p>;
    return (
      <div>
        <button onClick={() => { setArtist(null); loadQueue(); }} className="font-mono text-[11px] text-black/50 hover:text-black mb-4">
          ← Back to queue
        </button>

        {/* Header */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          {artist.photoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={artist.photoUrl} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-black/10" />
            : <div className="w-12 h-12 rounded-full bg-black/5 flex items-center justify-center font-mono text-sm font-bold">{artist.name.slice(0, 1).toUpperCase()}</div>}
          <div className="flex-1 min-w-0">
            <h2 className="text-heading-md truncate">{artist.name}</h2>
            <p className="font-mono text-[11px] text-black/50">
              Last snapshot: {artist.lastAgentDate ?? 'never'}
              {artist.isActive
                ? <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 font-bold uppercase text-[10px]">Active</span>
                : <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-800 font-bold uppercase text-[10px]">Paused</span>}
            </p>
          </div>
        </div>

        {/* Platform rows */}
        <div className="space-y-3 mb-6">
          {artist.platforms.map((p) => {
            const f = form[p.key];
            if (!p.connection) {
              return (
                <div key={p.key} className="border-2 border-dashed border-black/10 p-3 opacity-50">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider">{p.label}</span>
                  <span className="font-mono text-[10px] text-black/40 ml-3">no link on file</span>
                </div>
              );
            }
            return (
              <div key={p.key} className="border-2 border-black/10 p-4">
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider">{p.label}</span>
                  {p.connection.url ? (
                    <a href={p.connection.url} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-[11px] text-accent hover:underline inline-flex items-center gap-1 truncate max-w-[50%]">
                      {p.connection.url.replace(/^https?:\/\//, '')} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    </a>
                  ) : (
                    <span className="font-mono text-[10px] text-black/40">link saved without URL</span>
                  )}
                  {p.lastAgent?.anomaly && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-800">
                        {p.lastAgent.date} flagged
                      </span>
                      <button onClick={() => clearFlag(p.key, p.lastAgent!.date)}
                        className="font-mono text-[10px] text-amber-700 underline hover:text-amber-900"
                        title="Reviewed and legitimate — restore chart eligibility">
                        clear
                      </button>
                    </span>
                  )}
                  <select
                    value={f?.status ?? 'recorded'}
                    onChange={(e) => setForm((x) => ({ ...x, [p.key]: { ...x[p.key], status: e.target.value as AgentStatus } }))}
                    className="ml-auto border-2 border-black/15 px-2 py-1 font-mono text-[11px] focus:border-accent focus:outline-none"
                  >
                    {AGENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                {f?.status === 'recorded' && (
                  <div className="flex gap-3 flex-wrap">
                    {p.fields.map((field) => (
                      <div key={field.column}>
                        <label className="block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">
                          {field.label}
                          {p.lastAgent?.values?.[field.column] != null && (
                            <span className="ml-1 normal-case text-black/30">(last: {fmtNum(p.lastAgent.values[field.column])})</span>
                          )}
                        </label>
                        <input
                          inputMode="numeric"
                          value={f.values[field.column] ?? ''}
                          onChange={(e) => {
                            // Any edit invalidates a pending anomaly confirm —
                            // the listed deltas no longer match the inputs.
                            setAnomalies(null);
                            setForm((x) => ({
                              ...x,
                              [p.key]: { ...x[p.key], values: { ...x[p.key].values, [field.column]: e.target.value } },
                            }));
                          }}
                          placeholder="—"
                          className="w-36 border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none"
                        />
                        {p.prefill?.values?.[field.column] != null && (
                          <p className="font-mono text-[9px] text-green-700 mt-0.5">prefilled from {p.prefill.source === 'spotify_api' ? 'Spotify API' : 'YouTube API'}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Anomaly confirm */}
        {anomalies && anomalies.length > 0 && (
          <div className="border-2 border-amber-400 bg-amber-50/50 p-4 mb-4">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-4 h-4" /> Big swing — double-check these
            </p>
            <ul className="space-y-1 mb-3">
              {anomalies.map((a, i) => (
                <li key={i} className="font-mono text-xs text-amber-900">
                  {a.platform} · {a.column.replace(/_/g, ' ')}: {fmtNum(a.previous)} → {fmtNum(a.next)} ({a.pctChange}% change)
                </li>
              ))}
            </ul>
            <p className="font-mono text-[11px] text-amber-800 mb-3">
              If the numbers are right, confirm — they save flagged and stay off the charts until reviewed.
            </p>
            <button onClick={() => save(true)} disabled={saving}
              className="bg-amber-600 text-white font-mono text-[11px] font-bold uppercase tracking-wider px-4 py-2 hover:bg-amber-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Confirm & save flagged'}
            </button>
          </div>
        )}

        {notice && <p className="font-mono text-xs text-red-600 mb-3">{notice}</p>}

        <div className="flex items-center gap-3">
          <button onClick={() => save(false)} disabled={saving || (anomalies != null && anomalies.length > 0)}
            title={anomalies?.length ? 'Resolve the anomaly confirm above first (or edit the values)' : undefined}
            className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-black/80 disabled:opacity-50 inline-flex items-center gap-2">
            <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save & next'}
          </button>
          <button onClick={() => nextArtist(artist.userId)} disabled={saving}
            className="border-2 border-black/15 font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:border-black disabled:opacity-50 inline-flex items-center gap-2">
            <SkipForward className="w-4 h-4" /> Skip artist
          </button>
        </div>
      </div>
    );
  }

  // Queue screen.
  const artists = queue?.artists ?? [];
  const dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][queue?.dayIdx ?? 0];
  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h2 className="text-heading-md">AGENT STATS CONSOLE</h2>
        <span className="font-mono text-xs text-black/50">{dayName} · {queue?.dateStr}</span>
        <button onClick={loadQueue} className="p-2 border border-black/20 hover:border-black transition-colors ml-auto" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Due today', value: queue?.stats.due ?? 0, icon: Users },
          { label: 'Completed', value: queue?.stats.done ?? 0, icon: CircleCheck },
          { label: 'Remaining', value: queue?.stats.remaining ?? 0, icon: Clock },
        ].map((s) => (
          <div key={s.label} className="border border-black/10 p-4">
            <s.icon className="w-4 h-4 text-accent mb-2" />
            <p className="font-heading text-xl">{s.value}</p>
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        {artists.some((a) => !a.done) && (
          <button onClick={async () => { await ensureRun(); openArtist(artists.filter((a) => !a.done)[0].userId); }}
            className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 inline-flex items-center gap-2">
            <Play className="w-4 h-4" /> Start queue
          </button>
        )}
        {run && (
          <button onClick={finishRun}
            className="border-2 border-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-black hover:text-white inline-flex items-center gap-2">
            <Flag className="w-4 h-4" /> Finish run
          </button>
        )}
      </div>

      {artists.length === 0 ? (
        <p className="font-mono text-xs text-black/40 border-2 border-dashed border-black/10 p-6 text-center">
          Nothing due today. Artists appear here on their assigned weekday once they have platform links and recent paid activity.
        </p>
      ) : (
        <div className="space-y-2">
          {artists.map((a) => (
            <button key={a.userId} onClick={() => openArtist(a.userId)}
              className={`w-full border-2 p-3 flex items-center gap-3 text-left transition-colors ${a.done ? 'border-green-200 bg-green-50/30' : 'border-black/10 hover:border-black/30'}`}>
              {a.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={a.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                : <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center font-mono text-xs font-bold">{a.name.slice(0, 1).toUpperCase()}</div>}
              <div className="flex-1 min-w-0">
                <span className="font-mono text-sm font-bold truncate block">{a.name}</span>
                <span className="font-mono text-[10px] text-black/50">
                  {a.connectionCount} platform{a.connectionCount !== 1 ? 's' : ''} · last snapshot {a.lastAgentDate ?? 'never'}
                </span>
              </div>
              {a.done && <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 bg-green-100 text-green-700">Done</span>}
              {!a.done && a.missed && <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-800">Missed</span>}
              <ChevronRight className="w-4 h-4 text-black/30" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
