-- Migration 059: widen bookings.duration from integer → double precision
--
-- Why: engineers need to record actual session length in fractional
-- increments (1, 1.25, 1.5, 1.75, ...) after a session runs long. The
-- booking flow already operates on 30-minute slots and end_time math is
-- `start + duration * 3600s`, so storing duration as a float is the
-- natural fit. The integer column blocked any post-session correction
-- below an hour boundary, which is exactly what we hit with the Jordan
-- Hudson May 19 case (1hr scheduled, ran 1h30m, charged $55 back-half).
--
-- WHY `double precision` AND NOT `numeric(5,2)`:
-- PostgREST encodes `numeric` columns as JSON strings (to preserve
-- arbitrary precision for financial data). That would break every
-- `s + b.duration` accumulator in the app, because string concat would
-- replace addition silently. `double precision` is JSON-encoded as a
-- number, so consumers keep working unchanged.
--
-- WHY NOT `real`:
-- `real` (single precision, 24-bit mantissa) is enough for individual
-- quarter-hour values, but sums of many rows can accumulate visible
-- rounding noise (200 × 0.25 may land as 49.999999). Aggregates
-- (totalHours, sessionHours) show up in admin/engineer accounting,
-- so the wider mantissa of `double precision` (53 bits, 15-17 decimal
-- digits) is worth the extra 4 bytes per row.
--
-- All existing integer values cast losslessly. NOT NULL preserved.

ALTER TABLE bookings
  ALTER COLUMN duration TYPE double precision USING duration::double precision;

COMMENT ON COLUMN bookings.duration IS 'Session length in hours, double precision. Quarter-hour granularity supported (0.25 = 15 min). Used by completion math, accounting, availability blocking. JSON-encoded as a number (not string) so JS arithmetic works.';
