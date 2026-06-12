'use client';

// components/hub/RedeemSessionModal.tsx
//
// Round E Phase 4: customer books a studio session against their
// entitlement's prepaid hours. Studio B only, 24+ hours out, 8am-10pm,
// no surcharges (per Cole's rule — anything outside that profile uses
// the public /book flow at full retail).
//
// On success, the booking is created in the same `bookings` table the
// regular flow uses, with `package_entitlement_id` set and total_paid=0.
// The engineer side still sees + claims it like any other session.

import { useState, useMemo } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Clock, Calendar } from 'lucide-react';

interface Entitlement {
  id: string;
  template_name: string;
  ends_at: string;
  balances: Array<{
    kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
    quantity_granted: number;
    quantity_redeemed: number;
  }>;
}

interface Props {
  entitlement: Entitlement;
  onClose: () => void;
  onRedeemed: () => void;
}

export default function RedeemSessionModal({ entitlement, onClose, onRedeemed }: Props) {
  // Tomorrow as the default date floor (24+ hour buffer per backend
  // validation). Use ISO date string for <input type="date">.
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const studioBalance = entitlement.balances.find((b) => b.kind === 'studio_hours');
  const remainingHours = studioBalance
    ? studioBalance.quantity_granted - studioBalance.quantity_redeemed
    : 0;

  const [date, setDate] = useState<string>(tomorrow);
  const [startTime, setStartTime] = useState<string>('14:00'); // 2pm default
  const [hours, setHours] = useState<number>(Math.min(2, Math.max(1, remainingHours)));
  const [requestedEngineer, setRequestedEngineer] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Derived end time for display.
  const endTimeDisplay = useMemo(() => {
    if (!startTime) return '';
    const [h, m] = startTime.split(':').map(Number);
    const total = h + hours;
    const eh = Math.floor(total) % 24;
    const em = m + ((total % 1) * 60);
    return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
  }, [startTime, hours]);

  async function submit() {
    setError(null);
    if (!date || !startTime) {
      setError('Pick a date and start time.');
      return;
    }
    if (hours < 1 || hours > remainingHours) {
      setError(`Hours must be between 1 and ${remainingHours}.`);
      return;
    }

    // Build ISO datetimes. We store wall-clock-as-UTC per existing
    // codebase convention (booking system stores Fort Wayne time as
    // a UTC string).
    const startISO = `${date}T${startTime}:00.000Z`;
    const [h, m] = startTime.split(':').map(Number);
    const totalMinutes = h * 60 + m + hours * 60;
    const eh = Math.floor(totalMinutes / 60) % 24;
    const em = totalMinutes % 60;
    const endTimeStr = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    const endISO = `${date}T${endTimeStr}:00.000Z`;

    setBusy(true);
    try {
      const res = await fetch(`/api/packages/entitlements/${entitlement.id}/redeem-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_time: startISO,
          end_time: endISO,
          requested_engineer: requestedEngineer.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Could not redeem.');
        return;
      }
      setSuccess(true);
      setTimeout(() => onRedeemed(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4 py-8">
        <div className="bg-white text-black w-full max-w-lg border-2 border-black">
          {/* Header */}
          <div className="border-b-2 border-black px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Redeem Session</p>
              <h2 className="font-bold text-base truncate">{entitlement.template_name}</h2>
              <p className="font-mono text-[10px] text-black/55 mt-0.5">
                {remainingHours} hour{remainingHours === 1 ? '' : 's'} left
              </p>
            </div>
            <button onClick={onClose} className="text-black/40 hover:text-black"><X className="w-4 h-4" /></button>
          </div>

          {success ? (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
              <p className="font-bold text-base mb-1">Session booked</p>
              <p className="font-mono text-xs text-black/65">
                Confirmation email coming. An engineer will be assigned shortly.
              </p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* Constraints reminder */}
              <div className="bg-black/[0.03] border-l-2 border-accent px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-black/45 mb-1">
                  Membership session rules
                </p>
                <ul className="font-mono text-[11px] text-black/70 space-y-0.5">
                  <li>• Studio B only</li>
                  <li>• 24+ hours from now (no same-day)</li>
                  <li>• Between 8am and 10pm</li>
                  <li>• Need other? Use <a href="/book" className="underline">/book</a> at full price.</li>
                </ul>
              </div>

              {/* Date */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  min={tomorrow}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                />
              </div>

              {/* Start time + hours */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                    Start
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    min="08:00"
                    max="21:00"
                    step={1800}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                    Hours
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={remainingHours}
                    value={hours}
                    onChange={(e) => setHours(Math.max(1, Math.min(remainingHours, Number(e.target.value) || 1)))}
                    className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {/* Computed end + summary */}
              <div className="border-2 border-black/15 px-3 py-2 inline-flex items-center gap-2 w-full">
                <Calendar className="w-3.5 h-3.5 text-black/45" />
                <span className="font-mono text-[11px] text-black/65">
                  Studio B · {date} · {startTime} → {endTimeDisplay} ({hours}h)
                </span>
              </div>

              {/* Engineer pref */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                  Engineer preference (optional)
                </label>
                <input
                  type="text"
                  value={requestedEngineer}
                  onChange={(e) => setRequestedEngineer(e.target.value)}
                  placeholder="Iszac, Zion, Jay Val Leo, or any"
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                  Session notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="What you're working on, any prep needed."
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-y"
                />
              </div>

              {error && (
                <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <p className="font-mono text-xs text-red-900">{error}</p>
                </div>
              )}
            </div>
          )}

          {!success && (
            <div className="border-t-2 border-black px-5 py-3 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border border-black/20 hover:border-black"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || remainingHours < 1}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                {busy ? 'Booking…' : `Book ${hours}h · $0 (prepaid)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
