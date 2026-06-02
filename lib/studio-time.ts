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
