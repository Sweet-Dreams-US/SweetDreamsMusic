// lib/studio-time.ts
//
// Single source of truth for displaying times in the studio's local
// (Fort Wayne / Eastern) zone. Two families because the DB holds two
// timestamp conventions that need OPPOSITE handling to both show Eastern:
//
//   fmtSession*  — for WALL-CLOCK-AS-UTC columns (bookings.start_time/end_time,
//                  studio_blocks.start_time/end_time). Stored as the Fort Wayne
//                  wall clock labeled +00:00, so we read them back AS UTC to
//                  recover the intended local time. Do NOT convert.
//
//   fmtStamp*    — for TRUE-UTC instants (created_at, updated_at, *_at audit/
//                  event timestamps). Real UTC moments, so we CONVERT to
//                  Fort Wayne for studio-local display.
//
// See docs/superpowers/timezone-column-table.md for the column classification.
import { TIMEZONE } from '@/lib/constants';

function build(
  iso: string | null | undefined,
  base: Intl.DateTimeFormatOptions,
  opts: Intl.DateTimeFormatOptions | undefined,
  tz: string,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // timeZone is forced last so callers can tweak format but never the zone.
  return d.toLocaleString('en-US', { ...base, ...opts, timeZone: tz });
}

// ── Wall-clock-as-UTC (booking times) → read as UTC ──
export function fmtSessionTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { hour: 'numeric', minute: '2-digit' }, opts, 'UTC');
}
export function fmtSessionDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', year: 'numeric' }, opts, 'UTC');
}
export function fmtSessionDateTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts, 'UTC');
}

// ── True-UTC instants (created_at, *_at) → convert to Eastern ──
export function fmtStampTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { hour: 'numeric', minute: '2-digit' }, opts, TIMEZONE);
}
export function fmtStampDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', year: 'numeric' }, opts, TIMEZONE);
}
export function fmtStampDateTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return build(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts, TIMEZONE);
}

// ── <input type="datetime-local"> round-trip in studio-local (Eastern) ──
// datetime-local values are zone-naive "YYYY-MM-DDTHH:MM". To EDIT a stored
// true-UTC instant (events.starts_at) in studio-local time without shifting it,
// load the input via toStudioInputValue and save via studioInputToUtcISO.
// (The old code sliced the raw UTC ISO into the input and re-encoded it as
// browser-local on save, which shifted the time 4-5h on every edit.)

/** UTC ISO instant → "YYYY-MM-DDTHH:MM" in Eastern, for a datetime-local input. */
export function toStudioInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  let hour = get('hour');
  if (hour === '24') hour = '00'; // some ICU builds emit 24 for midnight
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** Eastern offset in ms at an instant: (Eastern wall clock as-if-UTC) − (true UTC). */
function easternOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asUtc - at.getTime();
}

/** "YYYY-MM-DDTHH:MM" entered as Eastern wall-clock → true-UTC ISO (DST-aware). */
export function studioInputToUtcISO(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  const naiveUtcMs = Date.UTC(y, mo - 1, d, h, mi);
  const offsetMs = easternOffsetMs(new Date(naiveUtcMs));
  return new Date(naiveUtcMs - offsetMs).toISOString();
}
