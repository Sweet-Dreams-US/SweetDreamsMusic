'use client';

// Media-team work surface (Phase 5). Mirrors EngineerDashboard's tab shell +
// EngineerSessions' interaction model, but for the shared media-job queue.
// Team-wide: every media manager sees every job; the assigned manager is shown
// on each card. All times render studio-local (fmtStamp*).

import { useState, useEffect, useCallback } from 'react';
import { Inbox, CalendarCheck, ListChecks, History } from 'lucide-react';
import MediaJobCard from './MediaJobCard';
import type { MediaTeamJob } from '@/lib/media-team-server';

type Tab = 'requests' | 'scheduled' | 'all' | 'history';

const TABS: { key: Tab; label: string; icon: typeof Inbox }[] = [
  { key: 'requests', label: 'Incoming Requests', icon: Inbox },
  { key: 'scheduled', label: 'Scheduled', icon: CalendarCheck },
  { key: 'all', label: 'All Jobs', icon: ListChecks },
  { key: 'history', label: 'History', icon: History },
];

export default function MediaManagerDashboard() {
  const [tab, setTab] = useState<Tab>('requests');
  const [jobs, setJobs] = useState<MediaTeamJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // One fetch of the full team queue powers every tab (small volume); we
      // bucket client-side. /unclaimed exists too but /jobs is the superset.
      const res = await fetch('/api/media/team/jobs');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const requests = jobs.filter((j) => j.status === 'requested');
  const scheduled = jobs.filter((j) => j.status === 'scheduled' || j.status === 'in_progress');
  const active = jobs.filter((j) => !['cancelled', 'completed'].includes(j.status));
  const history = jobs.filter((j) => j.status === 'completed' || j.status === 'cancelled');

  const shown =
    tab === 'requests' ? requests :
    tab === 'scheduled' ? scheduled :
    tab === 'all' ? active : history;

  const counts: Record<Tab, number> = {
    requests: requests.length,
    scheduled: scheduled.length,
    all: active.length,
    history: history.length,
  };

  return (
    <section className="bg-white text-black min-h-[60vh]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-heading-lg">MEDIA TEAM</h1>
          <p className="font-mono text-sm text-black/60 mt-1">
            Incoming shoot requests, scheduling, and your jobs. Everyone on the media team sees the
            same queue — the assigned manager is shown on each job.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 mb-6 border-b border-black/10">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 border-b-2 transition-colors inline-flex items-center gap-2 ${
                tab === t.key ? 'border-accent text-black' : 'border-transparent text-black/40 hover:text-black/70'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label} ({counts[t.key]})
            </button>
          ))}
        </div>

        {loading ? (
          <p className="font-mono text-sm text-black/60">Loading jobs…</p>
        ) : shown.length === 0 ? (
          <p className="font-mono text-xs text-black/60 border border-black/10 p-8 text-center">
            {tab === 'requests' ? 'No incoming requests right now.' : 'Nothing here yet.'}
          </p>
        ) : (
          <div className="space-y-3">
            {shown.map((job) => (
              <MediaJobCard key={job.id} job={job} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
