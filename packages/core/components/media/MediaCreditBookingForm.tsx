'use client';

// components/media/MediaCreditBookingForm.tsx
//
// Phase E credit-redemption booking form. The buyer picks a wallet, a
// date/time/duration, a room, and an engineer; submit creates a `bookings`
// row at $0 plus a `studio_credit_redemptions` link row. On success we
// redirect to /dashboard so the booking shows up in their normal list.
//
// We deliberately scope this narrower than the public /book flow:
//   - No Stripe. The credit IS the payment.
//   - No engineer-priority claim window — the buyer pre-assigns an
//     engineer (same model as the media-session scheduler).
//   - No same-day buffer logic. If you have credits and a slot's free,
//     book it.
//   - No guest-fee math. Credit hours are what you paid for; extras
//     would still need to come through /book.
//
// The server still does all conflict + ownership checks, so a tampered
// form can't actually book invalid state.

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import type { Room } from '@/lib/constants';

interface PoolOption {
  id: string;
  label: string;
  ownerType: 'user' | 'band';
  bandId: string | null;
  hoursRemaining: number;
}

interface EngineerOption {
  name: string;
  displayName: string;
  studios: Room[];
}

const ROOM_OPTIONS: { value: Room; label: string }[] = [
  { value: 'studio_a', label: 'Studio A' },
  { value: 'studio_b', label: 'Studio B' },
];

export default function MediaCreditBookingForm({
  pools,
  engineers,
}: {
  pools: PoolOption[];
  engineers: EngineerOption[];
}) {
  const router = useRouter();

  // Default the first wallet, tomorrow at 2pm, 2hrs, studio_a, first eligible engineer.
  const [poolId, setPoolId] = useState(pools[0]?.id ?? '');
  const [date, setDate] = useState(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState('14:00');
  const [duration, setDuration] = useState(2);
  const [room, setRoom] = useState<Room>('studio_a');
  // Default engineer is the first one eligible for the default room. Lazy
  // initializer so we only compute this once at mount.
  const [engineerName, setEngineerName] = useState<string>(() => {
    const eligible = engineers.filter((e) => e.studios.includes('studio_a'));
    return eligible[0]?.name ?? '';
  });
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Engineers eligible for the chosen room.
  const eligibleEngineers = useMemo(
    () => engineers.filter((e) => e.studios.includes(room)),
    [engineers, room],
  );

  // Room change handler — atomically update room AND reset the engineer
  // selection if the current pick can't work in the new room. Doing this
  // here (not in a useEffect) avoids the cascading-render anti-pattern
  // and matches React's "react to events, not state" guidance.
  function handleRoomChange(newRoom: Room) {
    setRoom(newRoom);
    const stillEligible = engineers
      .filter((e) => e.studios.includes(newRoom))
      .some((e) => e.name === engineerName);
    if (!stillEligible) {
      const fallback = engineers.find((e) => e.studios.includes(newRoom));
      setEngineerName(fallback?.name ?? '');
    }
  }

  const selectedPool = pools.find((p) => p.id === poolId);
  const overdraw = selectedPool ? duration > selectedPool.hoursRemaining : false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!poolId) {
      setError('Pick a wallet to draw from.');
      return;
    }
    if (overdraw) {
      setError(`Only ${selectedPool!.hoursRemaining.toFixed(1)} hr available — pick a shorter session.`);
      return;
    }
    if (!engineerName) {
      setError('Pick an engineer.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/media/credits/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credit_id: poolId,
          date,
          start_time: startTime,
          duration_hours: duration,
          room,
          engineer_name: engineerName,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Booking failed. Try again.');
        setSubmitting(false);
        return;
      }
      router.push('/dashboard?status=credit-booking-confirmed');
      router.refresh();
    } catch (err) {
      console.error('[credit-booking] error:', err);
      setError('Network error — try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Draw from">
        <select
          value={poolId}
          onChange={(e) => setPoolId(e.target.value)}
          className={inputCls}
        >
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.hoursRemaining.toFixed(1)} hr available
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
            min={1}
            max={Math.min(12, Math.floor(selectedPool?.hoursRemaining ?? 12))}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Math.floor(Number(e.target.value)) || 0)}
            className={inputCls}
            required
          />
          <p className="font-mono text-[11px] text-black/40 mt-1">
            Whole hours only. Live booking system stores integer durations; partial-hour credit
            balances roll over to your next session.
          </p>
        </Field>
        <Field label="Room">
          <select
            value={room}
            onChange={(e) => handleRoomChange(e.target.value as Room)}
            className={inputCls}
          >
            {ROOM_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Engineer">
        <select
          value={engineerName}
          onChange={(e) => setEngineerName(e.target.value)}
          className={inputCls}
          required
        >
          {eligibleEngineers.length === 0 ? (
            <option value="">No engineers configured for this room</option>
          ) : (
            eligibleEngineers.map((e) => (
              <option key={e.name} value={e.name}>
                {e.displayName}
              </option>
            ))
          )}
        </select>
      </Field>

      <Field label="Notes (optional)">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the engineer should prep — references, beat link, vibe."
          className={inputCls}
        />
      </Field>

      {overdraw && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-300 text-yellow-900 font-mono text-xs">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Duration exceeds your available balance. Drop it to {selectedPool!.hoursRemaining.toFixed(1)} hr or less.
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || overdraw}
        className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-6 py-4 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2 disabled:opacity-50"
      >
        {submitting ? 'Booking…' : 'Book session with credits'}
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
