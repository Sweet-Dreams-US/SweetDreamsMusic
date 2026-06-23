'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Calculator, ChevronDown, ChevronUp, Moon, Sun, Clock } from 'lucide-react';
import { formatCents, formatTime } from '@/lib/utils';
import { priceSessionFromConfig, type StudioConfig } from '@/lib/studio-config';

// Generate time slots from 9:00 to 23:30 in 30-min increments (covers full 24hr range relevant for booking)
function generateTimeSlots(): { label: string; value: string; hour: number }[] {
  const slots: { label: string; value: string; hour: number }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const time = `${h}:${m === 0 ? '00' : '30'}`;
      const decimalHour = h + m / 60;
      slots.push({ label: formatTime(time), value: time, hour: decimalHour });
    }
  }
  return slots;
}

const ALL_TIME_SLOTS = generateTimeSlots();

export default function PricingCalculator({ studios }: { studios: StudioConfig[] }) {
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<string>(studios[0]?.slug ?? 'studio_a');
  const [hours, setHours] = useState(2);
  const [startTime, setStartTime] = useState('12:0');
  // Booking Rush Fee is tiered by how soon the session starts. The calculator
  // lets you pick a lead-time tier, which maps straight to a per-booked-hour fee.
  const [rushPerHourCents, setRushPerHourCents] = useState(0);

  // Current room's DB-driven config (rates / hours / surcharges / tiers).
  const cfg = useMemo(() => studios.find((s) => s.slug === room) ?? studios[0], [studios, room]);
  const hourOptions = useMemo(() => Array.from({ length: cfg.maxHours }, (_, i) => i + 1), [cfg.maxHours]);

  const startHour = useMemo(() => {
    const [h, m] = startTime.split(':').map(Number);
    return h + (m || 0) / 60;
  }, [startTime]);

  const pricing = useMemo(
    () => priceSessionFromConfig(cfg, { hours, startHour, rushPerHourCents, guests: 1 }),
    [cfg, hours, startHour, rushPerHourCents]
  );

  const remainder = pricing.total - pricing.deposit;

  // Build query params for the Book Now link
  const bookParams = new URLSearchParams({
    room,
    hours: String(hours),
  });

  return (
    <div className="mt-12">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full border-2 border-black/10 p-6 flex items-center gap-4 hover:border-accent transition-colors text-left"
      >
        <Calculator className="w-8 h-8 text-accent flex-shrink-0" />
        <div className="flex-1">
          <p className="font-mono text-sm font-bold">SESSION PRICE CALCULATOR</p>
          <p className="font-mono text-xs text-black/40">
            Estimate your session cost before booking
          </p>
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-black/40" />
        ) : (
          <ChevronDown className="w-5 h-5 text-black/40" />
        )}
      </button>

      {open && (
        <div className="border-2 border-t-0 border-black/10 p-6 space-y-6">
          {/* Controls row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Room selector */}
            <div>
              <label className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 block mb-2">
                Room
              </label>
              <div className="flex gap-2">
                {studios.map((s) => (
                  <button
                    key={s.slug}
                    onClick={() => setRoom(s.slug)}
                    className={`flex-1 font-mono text-xs font-bold uppercase tracking-wider px-3 py-2.5 border-2 transition-colors ${
                      room === s.slug
                        ? 'border-accent bg-accent text-black'
                        : 'border-black/10 text-black/60 hover:border-black/30'
                    }`}
                  >
                    {s.displayName}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 block mb-2">
                Duration
              </label>
              <select
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="w-full font-mono text-sm border-2 border-black/10 px-3 py-2.5 bg-white hover:border-black/30 transition-colors appearance-none cursor-pointer"
              >
                {hourOptions.map((h) => (
                  <option key={h} value={h}>
                    {h} hour{h > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Start time */}
            <div>
              <label className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 block mb-2">
                Start Time
              </label>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full font-mono text-sm border-2 border-black/10 px-3 py-2.5 bg-white hover:border-black/30 transition-colors appearance-none cursor-pointer"
              >
                {ALL_TIME_SLOTS.map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Booking Rush Fee (tiered by how soon the session starts) */}
            <div>
              <label className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 block mb-2">
                Booking Rush Fee
              </label>
              <select
                value={rushPerHourCents}
                onChange={(e) => setRushPerHourCents(Number(e.target.value))}
                className={`w-full font-mono text-xs font-bold uppercase tracking-wider px-3 py-2.5 bg-white border-2 transition-colors appearance-none cursor-pointer ${
                  rushPerHourCents > 0
                    ? 'border-amber-500 text-amber-700'
                    : 'border-black/10 text-black/60 hover:border-black/30'
                }`}
              >
                <option value={0}>12h+ out — none</option>
                <option value={1000}>4–12h out — +{formatCents(1000)}/hr</option>
                <option value={2000}>2–4h out — +{formatCents(2000)}/hr</option>
                <option value={3000}>Under 2h — +{formatCents(3000)}/hr</option>
              </select>
            </div>
          </div>

          {/* The Sweet 4 badge (internal flag is still `sweetSpot` for backward compat) */}
          {pricing.sweetSpot && (
            <div className="bg-accent/10 border-2 border-accent px-4 py-3">
              <p className="font-mono text-xs font-bold text-accent uppercase tracking-wider">
                The Sweet 4 Applied — 4 hours at a discounted flat rate!
              </p>
            </div>
          )}

          {/* Hour-by-hour breakdown */}
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 mb-3">
              Hour-by-Hour Breakdown
            </p>
            <div className="space-y-1">
              {pricing.hourBreakdown.map((entry, i) => {
                const timeLabel = formatTime(`${Math.floor(entry.hour) % 24}:${entry.hour % 1 >= 0.5 ? '30' : '00'}`);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between font-mono text-xs py-1.5 px-3 border border-black/5"
                  >
                    <div className="flex items-center gap-2">
                      {entry.tier === 'deepNight' && <Moon className="w-3 h-3 text-indigo-500" />}
                      {entry.tier === 'lateNight' && <Moon className="w-3 h-3 text-amber-500" />}
                      {entry.tier === 'regular' && <Sun className="w-3 h-3 text-black/30" />}
                      <span className="text-black/60">{timeLabel}</span>
                      {entry.tier !== 'regular' && (
                        <span
                          className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${
                            entry.tier === 'deepNight'
                              ? 'bg-indigo-100 text-indigo-600'
                              : 'bg-amber-100 text-amber-600'
                          }`}
                        >
                          {entry.tier === 'deepNight' ? `Deep Night +${formatCents(entry.nightFee)}` : `Late Night +${formatCents(entry.nightFee)}`}
                        </span>
                      )}
                      {entry.bookingRushFee > 0 && (
                        <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-amber-50 text-amber-500">
                          Rush +{formatCents(entry.bookingRushFee)}
                        </span>
                      )}
                    </div>
                    <span className="font-semibold">{formatCents(entry.hourTotal)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals */}
          <div className="border-t-2 border-black/10 pt-4 space-y-2">
            <div className="flex justify-between font-mono text-xs">
              <span className="text-black/50">Base Rate ({hours}hr)</span>
              <span>{formatCents(pricing.subtotal)}</span>
            </div>
            {pricing.nightFees > 0 && (
              <div className="flex justify-between font-mono text-xs">
                <span className="text-amber-600">Night Fees</span>
                <span className="text-amber-600">+{formatCents(pricing.nightFees)}</span>
              </div>
            )}
            {pricing.bookingRushFee > 0 && (
              <div className="flex justify-between font-mono text-xs">
                <span className="text-amber-500">Booking Rush Fee</span>
                <span className="text-amber-500">+{formatCents(pricing.bookingRushFee)}</span>
              </div>
            )}
            <div className="flex justify-between font-mono text-sm font-bold border-t border-black/10 pt-2">
              <span>TOTAL</span>
              <span>{formatCents(pricing.total)}</span>
            </div>
            <div className="flex justify-between font-mono text-xs text-accent font-semibold">
              <span>Deposit Due ({cfg.depositPercent}%)</span>
              <span>{formatCents(pricing.deposit)}</span>
            </div>
            <div className="flex justify-between font-mono text-xs text-black/40">
              <span>Remainder at Session</span>
              <span>{formatCents(remainder)}</span>
            </div>
          </div>

          {/* Book Now */}
          <Link
            href={`/book?${bookParams.toString()}`}
            className="block w-full bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 text-center hover:bg-accent/90 transition-colors no-underline"
          >
            <Clock className="w-4 h-4 inline-block mr-2 -mt-0.5" />
            Book This Session
          </Link>
        </div>
      )}
    </div>
  );
}
