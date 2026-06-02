'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, ExternalLink, Music, ChevronDown, ChevronUp } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface Application {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  producer_name: string;
  portfolio_links: string[];
  genre_specialties: string[];
  sample_beat_path: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  admin_notes: string | null;
  created_at: string;
}

export default function ProducerApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('pending');
  const [processing, setProcessing] = useState<string | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/admin/producers/applications')
      .then((r) => r.json())
      .then((d) => setApplications(d.applications || []))
      .finally(() => setLoading(false));
  }, []);

  async function handleReview(applicationId: string, action: 'approved' | 'denied') {
    setProcessing(applicationId);
    const res = await fetch('/api/admin/producers/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId,
        action,
        adminNotes: noteInputs[applicationId] || null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setApplications((prev) =>
        prev.map((a) => (a.id === applicationId ? { ...a, ...data.application } : a))
      );
    }
    setProcessing(null);
  }

  const filtered = filter === 'all'
    ? applications
    : applications.filter((a) => a.status === filter);

  const counts = {
    all: applications.length,
    pending: applications.filter((a) => a.status === 'pending').length,
    approved: applications.filter((a) => a.status === 'approved').length,
    denied: applications.filter((a) => a.status === 'denied').length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-heading-md">PRODUCER APPLICATIONS</h2>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0 border-b border-black/10 mb-6 overflow-x-auto">
        {([
          { key: 'pending', label: 'Pending' },
          { key: 'approved', label: 'Approved' },
          { key: 'denied', label: 'Denied' },
          { key: 'all', label: 'All' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`font-mono text-xs uppercase tracking-wider px-4 py-3 border-b-2 transition-colors flex-shrink-0 ${
              filter === tab.key
                ? 'border-accent text-black font-bold'
                : 'border-transparent text-black/40 hover:text-black/70'
            }`}
          >
            {tab.label} ({counts[tab.key]})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="font-mono text-sm text-black/40">Loading applications...</p>
      ) : filtered.length === 0 ? (
        <div className="border-2 border-black/10 p-12 text-center">
          <Music className="w-12 h-12 text-black/10 mx-auto mb-4" />
          <p className="font-mono text-sm text-black/40">No {filter === 'all' ? '' : filter} applications</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => {
            const isExpanded = expandedId === app.id;
            return (
              <div key={app.id} className="border-2 border-black/10">
                {/* Summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : app.id)}
                  className="w-full p-4 flex items-center gap-4 text-left hover:bg-black/[0.02] transition-colors"
                >
                  <div className="flex-shrink-0">
                    {app.status === 'pending' && <Clock className="w-5 h-5 text-amber-500" />}
                    {app.status === 'approved' && <CheckCircle className="w-5 h-5 text-green-600" />}
                    {app.status === 'denied' && <XCircle className="w-5 h-5 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-semibold truncate">{app.producer_name}</p>
                    <p className="font-mono text-xs text-black/40">
                      {app.name} · {app.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {app.genre_specialties?.length > 0 && (
                      <span className="font-mono text-[10px] text-black/30 hidden sm:inline">
                        {app.genre_specialties.join(', ')}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-black/30">
                      {fmtStampDate(app.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-black/10 p-6 space-y-4">
                    {/* Portfolio links */}
                    {app.portfolio_links?.length > 0 && (
                      <div>
                        <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Portfolio</p>
                        <div className="space-y-1">
                          {app.portfolio_links.map((link, i) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1 block"
                            >
                              {link} <ExternalLink className="w-3 h-3" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reason */}
                    {app.reason && (
                      <div>
                        <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Why they want to sell</p>
                        <p className="font-mono text-sm text-black/70">{app.reason}</p>
                      </div>
                    )}

                    {/* Sample beat */}
                    {app.sample_beat_path && (
                      <div>
                        <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Sample Beat</p>
                        <p className="font-mono text-xs text-black/50">{app.sample_beat_path}</p>
                      </div>
                    )}

                    {/* Admin actions */}
                    {app.status === 'pending' && (
                      <div className="border-t border-black/10 pt-4 space-y-3">
                        <div>
                          <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">
                            Admin Notes
                          </label>
                          <textarea
                            value={noteInputs[app.id] || ''}
                            onChange={(e) => setNoteInputs((prev) => ({ ...prev, [app.id]: e.target.value }))}
                            rows={2}
                            className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-none"
                            placeholder="Internal notes..."
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleReview(app.id, 'approved')}
                            disabled={processing === app.id}
                            className="bg-green-600 text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            <CheckCircle className="w-3 h-3" /> Approve
                          </button>
                          <button
                            onClick={() => handleReview(app.id, 'denied')}
                            disabled={processing === app.id}
                            className="border border-red-300 text-red-600 font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            <XCircle className="w-3 h-3" /> Deny
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Show admin notes if already reviewed */}
                    {app.status !== 'pending' && app.admin_notes && (
                      <div>
                        <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Admin Notes</p>
                        <p className="font-mono text-xs text-black/50">{app.admin_notes}</p>
                      </div>
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
