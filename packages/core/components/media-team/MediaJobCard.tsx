'use client';

// A single media job in the team queue (Phase 5). Shows the requester, the
// shoot kind/time (studio-local), and — prominently, not behind a disclosure —
// the artist's VISION so the team can plan / call. Actions mirror the engineer
// session card: Accept (claim), Complete, Cancel (refunds the credit).

import { useState } from 'react';
import { Film, Camera, Megaphone, Phone, Video, Clock, MapPin, User, CheckCircle, XCircle, Sparkles } from 'lucide-react';
import { fmtStampDate, fmtStampTime } from '@/lib/studio-time';
import { CREDIT_KIND_LABELS, type CreditKind } from '@/lib/media-credits';
import type { MediaTeamJob } from '@/lib/media-team-server';

const KIND_ICON: Record<string, typeof Film> = {
  video: Video,
  photo: Camera,
  'marketing-meeting': Megaphone,
  planning_call: Phone,
  other: Film,
};

const STATUS_STYLE: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-green-100 text-green-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-black/5 text-black/60',
  cancelled: 'bg-red-100 text-red-700',
};

export default function MediaJobCard({ job, onChanged }: { job: MediaTeamJob; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const Icon = KIND_ICON[job.session_kind] || Film;

  async function act(action: 'accept' | 'complete' | 'cancel', confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(action);
    try {
      const res = await fetch('/api/media/team/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: job.id, action }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Action failed'); return; }
      onChanged();
    } catch {
      alert('Network error');
    } finally {
      setBusy(null);
    }
  }

  const kindLabel = job.credit_kind ? CREDIT_KIND_LABELS[job.credit_kind as CreditKind] : job.session_kind;
  const isRequest = job.status === 'requested';
  const isScheduled = job.status === 'scheduled' || job.status === 'in_progress';

  return (
    <div className={`border-2 p-4 sm:p-5 ${isRequest ? 'border-amber-300 bg-amber-50/40' : 'border-black/10'}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="w-4 h-4 text-accent shrink-0" />
            <span className="font-mono text-sm font-bold">{kindLabel}</span>
            {job.credit_tier && (
              <span className="font-mono text-[10px] uppercase tracking-wider bg-black/5 px-1.5 py-0.5">{job.credit_tier}</span>
            )}
            <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${STATUS_STYLE[job.status] || 'bg-black/5 text-black/60'}`}>
              {job.status === 'in_progress' ? 'in progress' : job.status}
            </span>
          </div>

          <p className="font-mono text-xs text-black/70 mt-1.5 flex items-center gap-1.5">
            <User className="w-3 h-3 shrink-0" />
            {job.requester_name || job.requester_email || 'Unknown artist'}
            {job.requester_email && job.requester_name && <span className="text-black/40">· {job.requester_email}</span>}
          </p>

          <p className="font-mono text-xs text-black/60 mt-1 flex items-center gap-1.5">
            <Clock className="w-3 h-3 shrink-0" />
            {fmtStampDate(job.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
            {fmtStampTime(job.starts_at)}–{fmtStampTime(job.ends_at)}
          </p>

          <p className="font-mono text-xs text-black/60 mt-1 flex items-center gap-1.5">
            <MapPin className="w-3 h-3 shrink-0" />
            {job.location === 'external' ? (job.external_location_text || 'External location') : 'Studio'}
          </p>

          {/* Assigned manager (team-wide visibility) */}
          {job.manager_name && (
            <p className="font-mono text-[10px] text-black/50 mt-1">
              Managed by <span className="font-bold">{job.manager_name}</span>
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 shrink-0">
          {isRequest && (
            <button
              onClick={() => act('accept')}
              disabled={!!busy}
              className="font-mono text-xs font-bold uppercase tracking-wider bg-[#F4C430] text-black px-4 py-2 hover:bg-[#F4C430]/80 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              <CheckCircle className="w-3.5 h-3.5" /> {busy === 'accept' ? 'Accepting…' : 'Accept'}
            </button>
          )}
          {isScheduled && (
            <button
              onClick={() => act('complete', 'Mark this shoot complete? The credit stays consumed.')}
              disabled={!!busy}
              className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-green-600 text-green-700 px-4 py-2 hover:bg-green-50 disabled:opacity-50 transition-colors"
            >
              {busy === 'complete' ? 'Saving…' : 'Mark Complete'}
            </button>
          )}
          {(isRequest || isScheduled) && (
            <button
              onClick={() => act('cancel', 'Cancel this job and refund the artist’s credit?')}
              disabled={!!busy}
              className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-red-300 text-red-600 px-4 py-2 hover:bg-red-50 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" /> {busy === 'cancel' ? '…' : 'Cancel'}
            </button>
          )}
        </div>
      </div>

      {/* Vision — shown prominently for planning, never hidden. */}
      {job.vision && (
        <div className="mt-3 pt-3 border-t border-black/10">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Artist&apos;s vision
          </p>
          <p className="font-mono text-sm text-black/80 whitespace-pre-wrap leading-relaxed">{job.vision}</p>
        </div>
      )}
    </div>
  );
}
