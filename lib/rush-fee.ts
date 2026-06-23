// lib/rush-fee.ts
// Tiered "Booking Rush Fee" for STUDIO sessions (NOT media shoots). Charged PER
// BOOKED HOUR, stacks with night/after-hours fees, bands exempt. The tier is
// decided purely by how many hours separate "now" from the session START in
// Eastern (Fort Wayne) wall-clock time — there is NO calendar-day logic.
//
//   < 2 hrs    -> $30/hr
//   2 to 4 hrs -> $20/hr
//   4 to 12 hrs-> $10/hr
//   12+ hrs    -> $0
//
// Examples (all confirmed with the studio):
//   11:50pm -> 1:00am  (1.17h) = $30/hr  (+ late-night fee — stacks)
//   12:10am -> 8:00am  (7.83h) = $10/hr
//   11:50pm -> next-day 9:00am (9.17h) = $10/hr
//   anything 12h+ out          = $0

export const BOOKING_RUSH_LABEL = 'Booking Rush Fee';

// Ordered ascending by upper bound. The first tier whose `underHours` exceeds
// the hours-until-session wins; past the last tier there is no fee.
export const RUSH_FEE_TIERS: { underHours: number; perHourCents: number }[] = [
  { underHours: 2, perHourCents: 3000 },
  { underHours: 4, perHourCents: 2000 },
  { underHours: 12, perHourCents: 1000 },
];

// Eastern (Fort Wayne). Indiana/Indianapolis observes Eastern time. Matches the
// timezone string used everywhere else in the booking code.
const STUDIO_TZ = 'America/Indiana/Indianapolis';

// Whole calendar-days between two YYYY-MM-DD strings (b - a). Parsed as UTC
// midnight so the subtraction is a clean integer-day delta with no tz drift.
function dayDiff(aYmd: string, bYmd: string): number {
  const [ay, am, ad] = aYmd.split('-').map(Number);
  const [by, bm, bd] = bYmd.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Hours between `now` and the session start, in Eastern wall-clock time.
 *  - `now`: the absolute instant (e.g. `new Date()`); converted to Eastern here,
 *    so it is correct whether this runs on the server (UTC) or in the browser.
 *  - `date`: 'YYYY-MM-DD' — the session's Eastern calendar date.
 *  - `startHour`: decimal hour (e.g. 13.5 = 1:30pm).
 * Returns a value that can be negative if the session start is already past.
 */
export function hoursUntilSession(now: Date, date: string, startHour: number): number {
  // `now` -> Eastern wall clock. toLocaleString gives the Eastern clock reading;
  // re-parsing preserves the hour/minute digits regardless of the runtime tz
  // (same pattern the availability + create routes already use).
  const todayEastern = now.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ }); // YYYY-MM-DD
  const nowEastern = new Date(now.toLocaleString('en-US', { timeZone: STUDIO_TZ }));
  const nowDecimal = nowEastern.getHours() + nowEastern.getMinutes() / 60 + nowEastern.getSeconds() / 3600;
  return dayDiff(todayEastern, date) * 24 + (startHour - nowDecimal);
}

/**
 * Per-booked-hour Booking Rush Fee in cents, by hours-until-session (Eastern).
 * Multiply by the number of booked hours to get the session's total rush fee.
 */
export function rushFeePerHourCents(now: Date, date: string, startHour: number): number {
  const h = hoursUntilSession(now, date, startHour);
  if (h < 0) return 0; // session start already passed — no rush fee
  for (const t of RUSH_FEE_TIERS) {
    if (h < t.underHours) return t.perHourCents;
  }
  return 0; // 12h+ out
}
