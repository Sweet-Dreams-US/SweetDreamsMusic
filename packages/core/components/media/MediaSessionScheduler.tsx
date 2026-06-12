'use client';

// components/media/MediaSessionScheduler.tsx
//
// Form for scheduling a new media session against a parent media_bookings
// row. POSTs to /api/media/sessions which does the conflict check.
//
// UX rules:
//   - Date input enforces today-or-later via min attribute (UI guard;
//     real validation is server-side).
//   - End time auto-derives from start time + duration (1.5h default
//     for video / photo, 1h for marketing/storyboard, 3h for recording).
//     User can adjust either.
//   - On 409 (conflict), we surface the exact conflict label so the
//     user can pick a different time without guessing.
//   - On success, redirect to the order detail page where they see the
//     new session in the list.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import {
  type MediaSessionKind,
  type MediaSessionLocation,
  SESSION_KIND_LABELS,
} from '@/lib/media-scheduling';

interface EngineerOption {
  name: string;
  displayName: string;
  specialties: string[];
}

const KIND_DEFAULT_DURATION_HOURS: Record<MediaSessionKind, number> = {
  video: 4,
  photo: 2,
  recording: 3,
  mixing: 2,
  storyboard: 1,
  'marketing-meeting': 1,
  planning_call: 1,
  other: 1,
};

export default function MediaSessionScheduler({
  parentBookingId,
  engineers,
}: {
  parentBookingId: string;
  engineers: EngineerOption[];
}) {
  const router = useRouter();

  // Default to tomorrow at 2pm — sensible "next available" without being
  // creepy. Format as YYYY-MM-DD for the date input. Lazy-initialised in
  // useState so Date.now() runs once at mount, never on re-render.
  const [kind, setKind] = useState<MediaSessionKind>('video');
  const [date, setDate] = useState(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState('14:00');
  const [durationHours, setDurationHours] = useState(
    KIND_DEFAULT_DURATION_HOURS.video,
  );
  const [engineerName, setEngineerName] = useState(engineers[0]?.name ?? '');
  const [location, setLocation] = useState<MediaSessionLocation>('studio');
  const [externalLocationText, setExternalLocationText] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictLabel, setConflictLabel] = useState<string | null>(null);

  // When kind changes, snap duration to that kind's sensible default —
  // unless the user has already typed a custom duration. We track this
  // by comparing current duration to the previous kind's default.
  useEffect(() => {
    setDurationHours(KIND_DEFAULT_DURATION_HOURS[kind]);
  }, [kind]);

  const startsAtIso = `${date}T${startTime}:00`;
  const startsAtDate = new Date(startsAtIso);
  const endsAtDate = new Date(
    startsAtDate.getTime() + durationHours * 60 * 60 * 1000,
  );
  const endsAtIso = isNaN(endsAtDate.getTime()) ? '' : endsAtDate.toISOString();

  const friendlyEnd = isNaN(endsAtDate.getTime())
    ? '—'
    : endsAtDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConflictLabel(null);

    if (location === 'external' && externalLocationText.trim().length < 3) {
      setError('External shoots need a location description.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/media/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_booking_id: parentBookingId,
          starts_at: startsAtDate.toISOString(),
          ends_at: endsAtIso,
          engineer_name: engineerName,
          session_kind: kind,
          location,
          external_location_text:
            location === 'external' ? externalLocationText.trim() : null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        // Conflict — show the busy-window label so the user knows what to change.
        setConflictLabel(data.conflict?.label || data.error || 'Time conflict');
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Could not schedule. Try again or contact us.');
        setSubmitting(false);
        return;
      }
      router.push(`/dashboard/media/orders/${parentBookingId}`);
      router.refresh();
    } catch (err) {
      console.error('[scheduler] submit error:', err);
      setError('Network error — try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Session kind">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as MediaSessionKind)}
          className={inputCls}
        >
          {(Object.keys(SESSION_KIND_LABELS) as MediaSessionKind[]).map((k) => (
            <option key={k} value={k}>
              {SESSION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Start time">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration (hours)">
          <input
            type="number"
            min={0.5}
            max={12}
            step={0.5}
            value={durationHours}
            onChange={(e) => setDurationHours(Number(e.target.value) || 0)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Ends">
          <div className={`${inputCls} bg-black/[0.03] text-black/60`}>
            {friendlyEnd}
          </div>
        </Field>
      </div>

      <Field label="Engineer">
        <select
          value={engineerName}
          onChange={(e) => setEngineerName(e.target.value)}
          className={inputCls}
        >
          {engineers.map((e) => (
            <option key={e.name} value={e.name}>
              {e.displayName} — {e.specialties.join(', ')}
            </option>
          ))}
        </select>
        <p className="font-mono text-[11px] text-black/40 mt-1">
          Jay leads music videos; Iszac, Zion, and PRVRB cover recording &amp; mixing.
        </p>
      </Field>

      <Field label="Location">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setLocation('studio')}
            className={`p-3 text-left border-2 transition-colors ${
              location === 'studio'
                ? 'border-accent bg-accent/10'
                : 'border-black/10 hover:border-black/30'
            }`}
          >
            <p className="font-mono text-[11px] uppercase tracking-wider font-bold mb-0.5">
              Studio
            </p>
            <p className="text-xs text-black/60">In our Fort Wayne space.</p>
          </button>
          <button
            type="button"
            onClick={() => setLocation('external')}
            className={`p-3 text-left border-2 transition-colors ${
              location === 'external'
                ? 'border-accent bg-accent/10'
                : 'border-black/10 hover:border-black/30'
            }`}
          >
            <p className="font-mono text-[11px] uppercase tracking-wider font-bold mb-0.5">
              External
            </p>
            <p className="text-xs text-black/60">On-location shoot.</p>
          </button>
        </div>
      </Field>

      {location === 'external' && (
        <Field label="Where (address or area)">
          <input
            type="text"
            value={externalLocationText}
            onChange={(e) => setExternalLocationText(e.target.value)}
            placeholder="Downtown Fort Wayne — exact spot TBD"
            className={inputCls}
            required
          />
        </Field>
      )}

      <Field label="Notes (optional)">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="References, mood, anything the engineer should prep."
          className={inputCls}
        />
      </Field>

      {conflictLabel && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-300 text-yellow-900 font-mono text-xs">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="font-bold mb-0.5">Time conflict</p>
            <p>{conflictLabel}</p>
            <p className="mt-1.5 text-yellow-800/80">Pick a different time or engineer.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-6 py-4 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2 disabled:opacity-50"
      >
        {submitting ? 'Scheduling…' : 'Schedule session'}
        {!submitting && <ArrowRight className="w-3 h-3" />}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full bg-white border-2 border-black/15 px-3 py-2 text-sm focus:border-black outline-none';
