'use client';

// Self-contained date + time picker — NO native <input type="date|time|
// datetime-local"> (those render terribly + the time spinner is broken in
// Safari). Mirrors the custom month-grid calendar already used in the studio
// BookingFlow, plus a tap-to-pick time-slot grid. Works identically across
// browsers.
//
// Value contract: a studio-local wall-clock string "YYYY-MM-DDTHH:MM" (the
// same shape studioInputToUtcISO expects), or '' when nothing is picked.
// `minISO` (same shape) disables earlier days + earlier slots on the min day.

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function daysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function firstDow(year: number, month: number) { return new Date(year, month, 1).getDay(); }
function pad(n: number) { return String(n).padStart(2, '0'); }

// "HH:MM" (24h) → "h:mm AM/PM"
function label12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}

export default function DateTimePicker({
  value,
  onChange,
  minISO,
  startHour = 6,
  endHour = 23,
  stepMinutes = 30,
}: {
  value: string;
  onChange: (v: string) => void;
  minISO?: string;
  startHour?: number;
  endHour?: number;
  stepMinutes?: number;
}) {
  const selectedDate = value ? value.slice(0, 10) : ''; // YYYY-MM-DD
  const selectedTime = value && value.length >= 16 ? value.slice(11, 16) : ''; // HH:MM

  const minDate = minISO ? minISO.slice(0, 10) : '';
  const minTime = minISO && minISO.length >= 16 ? minISO.slice(11, 16) : '';

  // Today (local) as YYYY-MM-DD for past-date disabling.
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  const floorDate = minDate && minDate > todayStr ? minDate : todayStr;

  // Which month the calendar is showing. Default to the selected/min/today month.
  const initial = selectedDate || minDate || todayStr;
  const [calYear, setCalYear] = useState(Number(initial.slice(0, 4)));
  const [calMonth, setCalMonth] = useState(Number(initial.slice(5, 7)) - 1);

  const timeSlots = useMemo(() => {
    const out: string[] = [];
    for (let h = startHour; h <= endHour; h++) {
      for (let m = 0; m < 60; m += stepMinutes) {
        if (h === endHour && m > 0) break; // include endHour:00 only
        out.push(`${pad(h)}:${pad(m)}`);
      }
    }
    return out;
  }, [startHour, endHour, stepMinutes]);

  function dayStr(day: number) { return `${calYear}-${pad(calMonth + 1)}-${pad(day)}`; }

  function pickDay(day: number) {
    const ds = dayStr(day);
    // Keep the chosen time if still valid for the new day, else clear it.
    const keepTime = selectedTime && !(ds === minDate && selectedTime < minTime);
    onChange(keepTime ? `${ds}T${selectedTime}` : `${ds}T`);
  }

  function pickTime(t: string) {
    const ds = selectedDate || floorDate;
    onChange(`${ds}T${t}`);
  }

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
    else setCalMonth((m) => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
    else setCalMonth((m) => m + 1);
  }

  const monthDisabledForPrev = `${calYear}-${pad(calMonth + 1)}` <= floorDate.slice(0, 7);

  return (
    <div className="border-2 border-black/15">
      {/* Calendar */}
      <div className="p-3 border-b-2 border-black/10">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={prevMonth}
            disabled={monthDisabledForPrev}
            className="p-1.5 hover:bg-black/5 disabled:opacity-25 disabled:cursor-not-allowed"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-sm font-bold uppercase tracking-wider">
            {MONTH_NAMES[calMonth]} {calYear}
          </span>
          <button type="button" onClick={nextMonth} className="p-1.5 hover:bg-black/5" aria-label="Next month">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {DAY_NAMES.map((d) => (
            <div key={d} className="text-center font-mono text-[10px] text-black/40 uppercase py-1">{d}</div>
          ))}
          {Array.from({ length: firstDow(calYear, calMonth) }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth(calYear, calMonth) }).map((_, i) => {
            const day = i + 1;
            const ds = dayStr(day);
            const disabled = ds < floorDate;
            const selected = ds === selectedDate;
            return (
              <button
                key={day}
                type="button"
                disabled={disabled}
                onClick={() => pickDay(day)}
                className={`aspect-square flex items-center justify-center font-mono text-xs transition-colors ${
                  disabled ? 'text-black/20 cursor-not-allowed'
                  : selected ? 'bg-black text-white font-bold'
                  : 'hover:bg-accent/20 cursor-pointer'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time slots */}
      <div className="p-3">
        <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {selectedDate ? 'Pick a time' : 'Pick a date first'}
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-40 overflow-y-auto">
          {timeSlots.map((t) => {
            // Disable slots before the min time on the min day.
            const disabled = !selectedDate || (selectedDate === minDate && t < minTime);
            const selected = t === selectedTime;
            return (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => pickTime(t)}
                className={`font-mono text-[11px] px-1 py-1.5 border transition-colors ${
                  disabled ? 'border-black/5 text-black/20 cursor-not-allowed'
                  : selected ? 'bg-accent text-black border-accent font-bold'
                  : 'border-black/15 hover:border-black cursor-pointer'
                }`}
              >
                {label12(t)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
