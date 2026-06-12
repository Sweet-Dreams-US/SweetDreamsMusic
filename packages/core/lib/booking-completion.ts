/**
 * Shared logic for checking whether a booking can be marked `completed`.
 *
 * Used by:
 *   - GET /api/booking/can-complete        (for UI feedback)
 *   - POST /api/booking/complete           (actual write, re-checks server-side)
 *   - Engineer checklist panels in the UI  (via the can-complete endpoint)
 *
 * Keeping the rule in one place prevents the server write and the UI hint
 * from ever drifting — both roads lead here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export const COMPLETION_GRACE_MINUTES = 30;
export const FW_TZ = 'America/Indiana/Indianapolis';

/**
 * App timezone convention — read before touching any date math here.
 *
 * Bookings store `start_time` / `end_time` as `timestamptz` values whose
 * clock digits represent Fort Wayne WALL-CLOCK time, tagged with a `+00`
 * UTC suffix even though the digits are not real UTC. Every display call
 * in the codebase uses `toLocale*('en-US', { timeZone: 'UTC' })` to
 * unpack the digits back out as-is (74+ call sites). See
 * components/engineer/EngineerSessions.tsx:340 for an example.
 *
 * Consequence: any comparison of stored timestamps to `Date.now()` (which
 * is real UTC) will be off by the Fort Wayne→UTC offset (−4h EDT, −5h EST).
 *
 * `fortWayneWallClockMsNow()` returns the current Fort Wayne wall time
 * as an epoch ms treating those wall-clock digits as if they were UTC —
 * which is the same space the stored timestamps live in. Compare against
 * `new Date(storedIso).getTime()` freely; both are wall-clock-as-ms.
 */
function fortWayneWallClockMsNow(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
  // Intl sometimes renders midnight as "24" in en-US hour12:false output.
  const hourRaw = get('hour');
  const hour = hourRaw === 24 ? 0 : hourRaw;
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second')
  );
}

export type CompletionReason =
  | 'already_completed'
  | 'cancelled'
  | 'too_early'
  | 'no_files_uploaded'
  | 'booking_missing';

export interface CompletionDetails {
  status: string | null;
  scheduledEnd: string | null; // ISO
  nowIso: string;
  minutesUntilAllowed: number; // 0 = allowed now, -1 = unknown (no end_time)
  filesCount: number;
  timeGatePassed: boolean;
  filesGatePassed: boolean;
}

export interface CompletionCheck {
  canComplete: boolean;
  reasons: CompletionReason[];
  reasonMessages: string[];
  details: CompletionDetails;
  // Raw fields the caller may need for ownership checks / logging.
  booking: {
    id: string;
    status: string | null;
    engineer_name: string | null;
    customer_email: string | null;
    customer_name: string | null;
    start_time: string | null;
    end_time: string | null;
    duration: number | null;
    band_id: string | null;
  } | null;
}

function reasonToMessage(r: CompletionReason, d: CompletionDetails): string {
  switch (r) {
    case 'booking_missing':
      return 'Booking not found.';
    case 'already_completed':
      return 'This session is already marked completed.';
    case 'cancelled':
      return 'This session is cancelled.';
    case 'too_early': {
      const m = d.minutesUntilAllowed;
      if (m < 0) return 'No scheduled end time — cannot determine completion window.';
      if (m === 0) return 'Too early — wait until 30 minutes before the session ends.';
      // Stored end_time's digits are Fort Wayne wall clock (per the
      // app's `+00`-means-local convention), so we unpack them with
      // timeZone: 'UTC' to avoid a double-conversion that would offset
      // the displayed time by −4h / −5h.
      const endLocal = d.scheduledEnd
        ? new Date(d.scheduledEnd).toLocaleString('en-US', {
            timeZone: 'UTC',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        : '—';
      return `Too early — completion allowed starting 30 min before end (${endLocal}). About ${m} min to go.`;
    }
    case 'no_files_uploaded':
      return 'No session files uploaded yet. Upload at least one deliverable before completing.';
  }
}

/**
 * Given an authenticated Supabase client (for the booking read) and a service
 * client (for the deliverables/profiles lookup that bypasses RLS), decide if
 * the booking is completable.
 *
 * The service client is needed because:
 *   - We want to find the deliverables by the customer's user_id, which
 *     requires a profile lookup that may be RLS-protected for regular engineers.
 *   - Engineers may not have a profile row that matches, but they should still
 *     get an accurate file count for sessions they're assigned to.
 */
export async function checkCanComplete(
  supabase: SupabaseClient,
  service: SupabaseClient,
  bookingId: string
): Promise<CompletionCheck> {
  // Auth was already verified at the route layer. Read via service client so
  // we're immune to whatever RLS policies exist (or will exist) on bookings
  // — every authorized caller sees a consistent view. `supabase` is still
  // passed in because downstream helpers (ownership) read `profiles` under
  // the caller's identity.
  void supabase; // kept in signature for symmetry with callers; intentionally unused here
  const { data: booking } = await service
    .from('bookings')
    .select('id, status, engineer_name, customer_email, customer_name, start_time, end_time, duration, band_id')
    .eq('id', bookingId)
    .maybeSingle();

  if (!booking) {
    const nowIso = new Date().toISOString();
    const details: CompletionDetails = {
      status: null,
      scheduledEnd: null,
      nowIso,
      minutesUntilAllowed: -1,
      filesCount: 0,
      timeGatePassed: false,
      filesGatePassed: false,
    };
    return {
      canComplete: false,
      reasons: ['booking_missing'],
      reasonMessages: [reasonToMessage('booking_missing', details)],
      details,
      booking: null,
    };
  }

  const reasons: CompletionReason[] = [];
  if (booking.status === 'completed') reasons.push('already_completed');
  if (booking.status === 'cancelled') reasons.push('cancelled');

  // --- Scheduled end ---
  let scheduledEndIso: string | null = booking.end_time ?? null;
  if (!scheduledEndIso && booking.start_time) {
    const startMs = new Date(booking.start_time).getTime();
    const hours = Number(booking.duration) || 0;
    scheduledEndIso = new Date(startMs + hours * 3_600_000).toISOString();
  }

  // --- Time gate ---
  // Compare Fort Wayne wall-clock-now against the stored UTC-digit end,
  // both expressed in the same wall-clock-as-ms space. See the
  // `fortWayneWallClockMsNow` doc comment above for why this is needed.
  const nowMs = fortWayneWallClockMsNow();
  const endMs = scheduledEndIso ? new Date(scheduledEndIso).getTime() : null;
  const allowedAtMs = endMs !== null ? endMs - COMPLETION_GRACE_MINUTES * 60_000 : null;

  const timeGatePassed = allowedAtMs === null ? false : nowMs >= allowedAtMs;
  const minutesUntilAllowed =
    allowedAtMs === null ? -1 : Math.max(0, Math.ceil((allowedAtMs - nowMs) / 60_000));

  if (!timeGatePassed) reasons.push('too_early');

  // --- Files gate ---
  let filesCount = 0;
  let filesGatePassed = false;

  if (booking.customer_email) {
    const { data: profile } = await service
      .from('profiles')
      .select('user_id')
      .eq('email', booking.customer_email)
      .maybeSingle();

    let userId: string | null = profile?.user_id ?? null;

    if (!userId) {
      try {
        const { data: listData } = await service.auth.admin.listUsers({ perPage: 1000 });
        const match = listData?.users?.find(
          (u: { email?: string }) =>
            u.email?.toLowerCase() === booking.customer_email!.toLowerCase()
        );
        if (match) userId = match.id;
      } catch {
        // leave filesCount=0 — gate simply won't pass
      }
    }

    if (userId && booking.start_time) {
      const { count } = await service
        .from('deliverables')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', booking.start_time);
      filesCount = count ?? 0;
      filesGatePassed = filesCount > 0;
    }
  }

  if (!filesGatePassed) reasons.push('no_files_uploaded');

  const details: CompletionDetails = {
    status: booking.status ?? null,
    scheduledEnd: scheduledEndIso,
    // nowIso is a real-UTC timestamp for debug/logging only; nowMs above
    // is in Fort Wayne wall-clock-as-ms space (used for comparison) and
    // must not be round-tripped through Date → ISO, or consumers would
    // read a misleading clock.
    nowIso: new Date().toISOString(),
    minutesUntilAllowed,
    filesCount,
    timeGatePassed,
    filesGatePassed,
  };

  return {
    canComplete: reasons.length === 0,
    reasons,
    reasonMessages: reasons.map(r => reasonToMessage(r, details)),
    details,
    booking: {
      id: booking.id,
      status: booking.status ?? null,
      engineer_name: booking.engineer_name ?? null,
      customer_email: booking.customer_email ?? null,
      customer_name: booking.customer_name ?? null,
      start_time: booking.start_time ?? null,
      end_time: booking.end_time ?? null,
      duration: booking.duration ?? null,
      band_id: (booking as any).band_id ?? null,
    },
  };
}
