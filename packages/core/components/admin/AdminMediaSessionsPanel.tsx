'use client';

// Admin oversight panel for media requests + sessions (Phase 6). Collapsible,
// read-first: admins see the full media queue (status, artist, assigned
// manager, time, vision) inside Bookings. Active management happens on the
// Media Team dashboard (admins have access) or the existing per-booking media
// admin endpoints; this panel is the at-a-glance "what's happening in media".

import { useEffect, useState, useCallback } from 'react';
import { Film, ChevronDown, RefreshCw } from 'lucide-react';
import { fmtStampDate, fmtStampTime } from '@/lib/studio-time';
import { CREDIT_KIND_LABELS, type CreditKind } from '@/lib/media-credits';
import type { MediaTeamJob } from '@/lib/media-team-server';

const STATUS_STYLE: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-green-100 text-green-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-black/5 text-black/60',
  cancelled: 'bg-red-100 text-red-700',
};

export default function AdminMediaSessionsPanel() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<MediaTeamJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/media/sessions');
      const data = await res.json();
      setJobs(data.jobs || []);
      setLoaded(true);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy-load on first expand.
  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  const requests = jobs.filter((j) => j.status === 'requested').length;

  return (
    <div className="border-2 border-black/10 mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] transition-colors"
      >
        <span className="font-mono text-sm font-bold uppercase tracking-wider inline-flex items-center gap-2">
          <Film className="w-4 h-4 text-accent" />
          Media Requests &amp; Sessions
          {requests > 0 && (
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-200 text-amber-800">
              {requests} awaiting team
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-black/10 p-4">
          <div className="flex justify-end mb-3">
            <button
              onClick={load}
              disabled={loading}
              className="font-mono text-[10px] uppercase tracking-wider text-black/50 hover:text-black inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          {!loaded && loading ? (
            <p className="font-mono text-xs text-black/50">Loading…</p>
          ) : jobs.length === 0 ? (
            <p className="font-mono text-xs text-black/50 text-center py-6">No media sessions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="bg-black/5 text-left">
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">Artist</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">When</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider hidden sm:table-cell">Manager</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t border-black/5 align-top">
                      <td className="px-3 py-2">
                        {j.credit_kind ? CREDIT_KIND_LABELS[j.credit_kind as CreditKind] : j.session_kind}
                        {j.vision && (
                          <span className="block text-black/40 max-w-[260px] truncate" title={j.vision}>
                            “{j.vision}”
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{j.requester_name || j.requester_email || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtStampDate(j.starts_at, { month: 'short', day: 'numeric' })} · {fmtStampTime(j.starts_at)}
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">{j.manager_name || <span className="text-black/30">unclaimed</span>}</td>
                      <td className="px-3 py-2">
                        <span className={`font-bold uppercase text-[10px] px-1.5 py-0.5 ${STATUS_STYLE[j.status] || 'bg-black/5 text-black/60'}`}>
                          {j.status === 'in_progress' ? 'in progress' : j.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
