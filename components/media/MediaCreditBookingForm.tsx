'use client';

// components/media/MediaCreditBookingForm.tsx
//
// Free-studio-hour credit-redemption form.
//
// MONEY MODEL (reworked — was a $0 "the credit IS the payment" flow):
//   A free studio hour discounts ONE hour of BASE studio time (room-aware,
//   capped at the booked hours). The customer still pays the FULL surcharge
//   (late-night / deep-night / same-day) up front by card, plus — for 2+ hour
//   bookings — the discounted half of the deposit. The exact cents math is the
//   PURE computeCreditRedemptionPricing (lib/credit-redemption-pricing), which
//   we run live here for the price-breakdown preview AND the API re-runs
//   server-side as the source of truth on submit.
//
//   • amountDueNow > 0 → submit returns a Stripe Checkout URL; we redirect.
//     The booking is confirmed + the credit decremented by the webhook on
//     payment, so an abandoned checkout never burns the free hour.
//   • amountDueNow == 0 → instant confirm (no Stripe), straight to /dashboard.
//
//   Any duration 1–12 hours is allowed now — extra hours beyond the credit are
//   simply paid for. The server still does all conflict + ownership checks.

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import type { Room } from '@/lib/constants';
import type { StudioConfig } from '@/lib/studio-config';
import { computeCreditRedemptionPricing } from '@/lib/credit-redemption-pricing';
import { formatCents, parseTimeSlot } from '@/lib/utils';

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

const MAX_DURATION = 12;

export default function MediaCreditBookingForm({
  pools,
  engineers,
  pricingByRoom,
  todayLocal,
}: {
  pools: PoolOption[];
  engineers: EngineerOption[];
  pricingByRoom: Record<Room, StudioConfig>;
  /** Today's date (YYYY-MM-DD) in studio-local (Eastern) time — for same-day flagging. */
  todayLocal: string;
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
  // selection if the current pick can't work in the new room.
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
  const sameDay = date === todayLocal;

  // Live price breakdown — the SAME pure function the API uses on submit.
  const quote = useMemo(() => {
    if (!selectedPool || !pricingByRoom[room] || duration < 1) return null;
    return computeCreditRedemptionPricing({
      room,
      hours: duration,
      startHourLocal: parseTimeSlot(startTime),
      sameDay,
      guestCount: 0,
      creditHoursRemaining: selectedPool.hoursRemaining,
      pricing: pricingByRoom[room],
    });
  }, [selectedPool, pricingByRoom, room, duration, startTime, sameDay]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!poolId) {
      setError('Pick a wallet to draw from.');
      return;
    }
    if (duration < 1 || duration > MAX_DURATION) {
      setError(`Pick a duration between 1 and ${MAX_DURATION} hours.`);
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
      // Money due → Stripe Checkout. Otherwise instant-confirmed → dashboard.
      if (data.requires_payment && data.checkout_url) {
        window.location.href = data.checkout_url as string;
        return; // leave submitting=true through the redirect
      }
      router.push('/dashboard?status=credit-booking-confirmed');
      router.refresh();
    } catch (err) {
      console.error('[credit-booking] error:', err);
      setError('Network error — try again.');
      setSubmitting(false);
    }
  }

  const payNow = quote?.amountDueNow ?? 0;

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
            max={MAX_DURATION}
            step={1}
            value={duration}
            onChange={(e) =>
              setDuration(
                Math.min(MAX_DURATION, Math.max(1, Math.floor(Number(e.target.value)) || 1)),
              )
            }
            className={inputCls}
            required
          />
          <p className="font-mono text-[11px] text-black/40 mt-1">
            Whole hours, 1–{MAX_DURATION}. Your free hour covers one hour of base
            studio time; any extra hours are billed.
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

      {/* Price breakdown — shown BEFORE confirming so the customer sees exactly
          what the free hour covers, what surcharges apply, and what they pay
          now vs. later. */}
      {quote && (
        <div className="border-2 border-black/15 bg-black/[0.02] p-4 space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-2">
            Price breakdown
          </p>
          <Row label={`Studio time (${duration} hr base)`} value={formatCents(quote.base)} />
          {quote.surcharges > 0 && (
            <Row
              label={`Surcharges${sameDay ? ' (incl. same-day)' : ''}`}
              value={formatCents(quote.surcharges)}
            />
          )}
          <Row label="Session total" value={formatCents(quote.total)} bold />
          <Row
            label={`Free-hour credit (${quote.creditHoursApplied} hr)`}
            value={`− ${formatCents(quote.discount)}`}
            accent
          />
          <div className="border-t border-black/10 my-1.5" />
          <Row label="Due now (card)" value={formatCents(quote.amountDueNow)} bold />
          {quote.remainder > 0 && (
            <Row label="Remainder (after session)" value={formatCents(quote.remainder)} />
          )}
          {quote.amountDueNow === 0 && (
            <p className="font-mono text-[11px] text-green-700 pt-1">
              Fully covered by your free hour — nothing to pay. Confirms instantly.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !quote}
        className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-6 py-4 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2 disabled:opacity-50"
      >
        {submitting
          ? payNow > 0
            ? 'Redirecting to checkout…'
            : 'Booking…'
          : payNow > 0
            ? `Pay ${formatCents(payNow)} & book`
            : 'Confirm booking (free)'}
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

function Row({
  label,
  value,
  bold,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className={`font-mono text-xs ${accent ? 'text-green-700' : 'text-black/60'}`}>
        {label}
      </span>
      <span className={`font-mono text-xs ${bold ? 'font-bold' : ''} ${accent ? 'text-green-700' : ''}`}>
        {value}
      </span>
    </div>
  );
}

const inputCls =
  'w-full bg-white border-2 border-black/15 px-3 py-2 text-sm focus:border-black outline-none';
