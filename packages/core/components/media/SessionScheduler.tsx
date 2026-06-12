'use client';

// components/media/SessionScheduler.tsx
//
// Round 8d: per-line-item date negotiation. Renders inline under each
// line item on both PackageBuilder (admin) and PackageReview (buyer).
//
// Flow:
//   1. Either side clicks "Propose date" → form: starts_at, ends_at,
//      location, kind, notes
//   2. Other side sees the proposal with "Approve" + "Counter-propose"
//   3. Approve flips status → 'scheduled' (admin must set engineer_id
//      for non-call kinds)
//   4. Counter-propose creates a new row pointing at the original via
//      supersedes_id; original row marked 'superseded'
//
// Engineer assignment: admin-only. Pulled from the existing ENGINEERS
// roster client-side (kept simple — no fancy dropdown logic, just the
// canonical names).

import { useCallback, useEffect, useState } from 'react';
import { Calendar, MapPin, Plus, Loader2, AlertCircle, CheckCircle2, ArrowRight, Building2, RotateCcw } from 'lucide-react';
import { ENGINEERS } from '@/lib/constants';
import { fmtStampDateTime, fmtStampTime } from '@/lib/studio-time';
import { useBrand } from '@/components/brand/BrandProvider';

interface Session {
  id: string;
  line_item_id: string | null;
  parent_booking_id: string;
  starts_at: string;
  ends_at: string;
  location: 'studio' | 'external';
  external_location_text: string | null;
  engineer_id: string | null;
  session_kind: string;
  status: 'proposed' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'superseded';
  proposed_by: 'admin' | 'buyer' | null;
  proposed_at: string | null;
  approved_at: string | null;
  supersedes_id: string | null;
  notes: string | null;
}

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'planning_call', label: 'Planning call' },
  { value: 'design_meeting', label: 'Design meeting' },
  { value: 'recording_session', label: 'Recording session' },
  { value: 'mixing_session', label: 'Mixing session' },
  { value: 'photo_shoot', label: 'Photo shoot' },
  { value: 'video', label: 'Video shoot (studio)' },
  { value: 'filming_external', label: 'External filming' },
  { value: 'other', label: 'Other' },
];

interface Props {
  bookingId: string;
  lineId: string;
  lineLabel: string;
  /** Default session_kind to suggest in the proposal form */
  defaultKind?: string;
}

export default function SessionScheduler({ bookingId, lineId, lineLabel, defaultKind = 'other' }: Props) {
  const b = useBrand();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [role, setRole] = useState<'admin' | 'buyer' | 'engineer' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [supersedesId, setSupersedesId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState<'studio' | 'external'>('studio');
  const [externalText, setExternalText] = useState('');
  const [sessionKind, setSessionKind] = useState(defaultKind);
  const [notes, setNotes] = useState('');
  const [approverEngineerId, setApproverEngineerId] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/media/bookings/${bookingId}/line-items/${lineId}/sessions`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError('Could not load sessions.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSessions(data.sessions as Session[]);
      setRole(data.role);
      setError(null);
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, [bookingId, lineId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (submitting) return;
    if (!startsAt || !endsAt) {
      setError('Pick start + end times');
      return;
    }
    if (location === 'external' && !externalText.trim()) {
      setError('External location text required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/bookings/${bookingId}/line-items/${lineId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
          location,
          external_location_text: location === 'external' ? externalText.trim() : null,
          session_kind: sessionKind,
          notes: notes.trim() || null,
          supersedes_id: supersedesId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to propose.');
      } else {
        await load();
        setShowForm(false);
        setSupersedesId(null);
        setStartsAt(''); setEndsAt(''); setNotes(''); setExternalText('');
      }
    } catch {
      setError('Network error.');
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async (sessionId: string, kind: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const needsEngineer = kind !== 'planning_call' && kind !== 'design_meeting';
      if (needsEngineer && role === 'admin' && !approverEngineerId) {
        setError('Pick an engineer to assign before approving.');
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/media/bookings/${bookingId}/sessions/${sessionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(role === 'admin' ? { engineer_id: approverEngineerId || null } : {}),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Approve failed.');
      else { await load(); setApproverEngineerId(''); }
    } catch {
      setError('Network error.');
    } finally {
      setSubmitting(false);
    }
  };

  const counter = (sessionId: string) => {
    setSupersedesId(sessionId);
    setShowForm(true);
  };

  if (loading) {
    return (
      <div className="text-center py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin inline-block text-black/40" />
        <span className="font-mono text-[10px] text-black/40 ml-1">loading sessions…</span>
      </div>
    );
  }

  const activeSessions = sessions.filter((s) => s.status !== 'cancelled');
  const proposedCount = activeSessions.filter((s) => s.status === 'proposed').length;
  const scheduledCount = activeSessions.filter((s) => s.status === 'scheduled').length;
  const canPost = role === 'admin' || role === 'buyer';

  return (
    <div className="border border-black/10 bg-black/[0.02] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wider text-black/60 inline-flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          Sessions for: {lineLabel}
        </p>
        {canPost && !showForm && (
          <button
            onClick={() => { setSupersedesId(null); setShowForm(true); }}
            className="font-mono text-[10px] uppercase tracking-wider text-accent hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Propose date
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 font-mono text-[11px] px-2 py-1 flex items-start gap-1">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {activeSessions.length === 0 && !showForm && (
        <p className="font-mono text-[11px] text-black/50 text-center py-2">
          No dates proposed yet.
          {canPost && ' Click "Propose date" to start.'}
        </p>
      )}

      {activeSessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          role={role}
          submitting={submitting}
          onApprove={() => approve(s.id, s.session_kind)}
          onCounter={() => counter(s.id)}
          approverEngineerId={approverEngineerId}
          setApproverEngineerId={setApproverEngineerId}
        />
      ))}

      {showForm && (
        <div className="border-2 border-black bg-white p-2 space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/70">
            {supersedesId ? 'Counter-propose' : 'Propose new date'}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="border border-black/20 px-2 py-1 font-mono text-xs"
            />
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="border border-black/20 px-2 py-1 font-mono text-xs"
            />
          </div>
          <div className="flex gap-1.5">
            <select
              value={sessionKind}
              onChange={(e) => setSessionKind(e.target.value)}
              className="border border-black/20 px-2 py-1 font-mono text-[11px]"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value as 'studio' | 'external')}
              className="border border-black/20 px-2 py-1 font-mono text-[11px]"
            >
              <option value="studio">{b.name} Studio</option>
              <option value="external">External location</option>
            </select>
          </div>
          {location === 'external' && (
            <input
              type="text"
              placeholder="Where? (e.g., 'Riverside warehouse, Fort Wayne')"
              value={externalText}
              onChange={(e) => setExternalText(e.target.value)}
              className="w-full border border-black/20 px-2 py-1 font-mono text-xs"
            />
          )}
          <input
            type="text"
            placeholder="Notes (e.g., 'Bring vintage gear')"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-black/20 px-2 py-1 font-mono text-[11px]"
          />
          <div className="flex gap-1.5">
            <button
              onClick={submit}
              disabled={submitting}
              className="bg-black text-white font-mono text-[11px] uppercase tracking-wider px-3 py-1 hover:bg-accent hover:text-black transition-colors disabled:opacity-50 inline-flex items-center gap-1"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              {supersedesId ? 'Counter-propose' : 'Propose'}
            </button>
            <button
              onClick={() => { setShowForm(false); setSupersedesId(null); }}
              className="font-mono text-[11px] text-black/60 hover:text-black px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {scheduledCount > 0 && (
        <p className="font-mono text-[10px] text-green-700 text-right">
          ✓ {scheduledCount} scheduled · {proposedCount} pending
        </p>
      )}
    </div>
  );
}

function SessionRow({
  session,
  role,
  submitting,
  onApprove,
  onCounter,
  approverEngineerId,
  setApproverEngineerId,
}: {
  session: Session;
  role: 'admin' | 'buyer' | 'engineer' | null;
  submitting: boolean;
  onApprove: () => void;
  onCounter: () => void;
  approverEngineerId: string;
  setApproverEngineerId: (v: string) => void;
}) {
  const b = useBrand();
  const startLabel = fmtStampDateTime(session.starts_at, { weekday: 'short' });
  const endLabel = fmtStampTime(session.ends_at);
  const statusColor =
    session.status === 'scheduled'
      ? 'bg-green-100 text-green-900'
      : session.status === 'proposed'
        ? 'bg-amber-100 text-amber-900'
        : 'bg-black/10 text-black/60';

  // Counter-propose / approve only available if THIS proposal came from
  // the OTHER side. Engineers can only watch.
  const isProposed = session.status === 'proposed';
  const otherSideProposed =
    isProposed && (
      (role === 'admin' && session.proposed_by === 'buyer') ||
      (role === 'buyer' && session.proposed_by === 'admin')
    );
  const canApprove = otherSideProposed;
  const canCounter = otherSideProposed;
  const needsEngineer = session.session_kind !== 'planning_call' && session.session_kind !== 'design_meeting';

  return (
    <div className="border border-black/10 bg-white p-2 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs font-bold">
              {startLabel} – {endLabel}
            </span>
            <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 ${statusColor}`}>
              {session.status}
            </span>
            {session.proposed_by && session.status === 'proposed' && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-black/50">
                by {session.proposed_by}
              </span>
            )}
            {session.supersedes_id && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-black/50 inline-flex items-center gap-0.5">
                <RotateCcw className="w-2.5 h-2.5" />
                counter
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] text-black/65 mt-0.5 inline-flex items-center gap-1">
            {session.location === 'studio' ? (
              <><Building2 className="w-3 h-3" /> {b.name} Studio</>
            ) : (
              <><MapPin className="w-3 h-3" /> {session.external_location_text || 'External (TBD)'}</>
            )}
            <span className="text-black/40">·</span>
            <span>{session.session_kind}</span>
          </p>
          {session.notes && (
            <p className="text-[11px] text-black/55 italic mt-0.5">&ldquo;{session.notes}&rdquo;</p>
          )}
        </div>
      </div>

      {canApprove && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-black/5">
          {role === 'admin' && needsEngineer && (
            <select
              value={approverEngineerId}
              onChange={(e) => setApproverEngineerId(e.target.value)}
              className="border border-black/20 px-1 py-0.5 font-mono text-[10px]"
            >
              <option value="">Pick engineer…</option>
              {ENGINEERS.map((eng) => (
                <option key={eng.name} value={eng.name}>{eng.displayName}</option>
              ))}
            </select>
          )}
          <button
            onClick={onApprove}
            disabled={submitting}
            className="bg-black text-white font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 hover:bg-accent hover:text-black transition-colors disabled:opacity-50 inline-flex items-center gap-0.5"
          >
            <CheckCircle2 className="w-2.5 h-2.5" />
            Approve
          </button>
          {canCounter && (
            <button
              onClick={onCounter}
              disabled={submitting}
              className="border border-black/20 hover:border-black font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 transition-colors inline-flex items-center gap-0.5"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Counter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
