'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Calendar, Clock, Home, User, Users, ChevronLeft, ChevronRight, AlertTriangle, Star, Video, Music2 } from 'lucide-react';
import { formatCents, cn, isSameDay, formatTime, parseTimeSlot, decimalToTimeStr } from '@/lib/utils';
import { priceSessionFromConfig, priceBandFromConfig, hourSurchargeFromConfig, sweetSpotAddonCents, type StudioConfig } from '@/lib/studio-config';

// Self-serve band tiers. As of 2026-04-28 the 24h ("3 Days") tier is
// self-serve bookable — checkout creates 3 linked bookings rows and the
// team follows up by phone to finalize logistics. The 24h tier price is
// for the WHOLE block; we charge it once via Stripe, not three times.
const BAND_DURATIONS: ReadonlyArray<4 | 8 | 24> = [4, 8, 24] as const;

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Generate 30-minute time slots (48 per day)
function generateTimeSlots() {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    slots.push(`${h}:00`);
    slots.push(`${h}:30`);
  }
  return slots;
}

function tierLabel(tier: 'regular' | 'lateNight' | 'deepNight'): string {
  if (tier === 'lateNight') return 'Late Night';
  if (tier === 'deepNight') return 'After Hours';
  return '';
}

function tierColor(tier: 'regular' | 'lateNight' | 'deepNight'): string {
  if (tier === 'lateNight') return 'text-amber-600';
  if (tier === 'deepNight') return 'text-red-500';
  return 'text-black/60';
}

export default function BookingFlow({
  userName,
  userEmail,
  studios,
  engineers,
  band = null,
  freeHourBalance = 0,
}: {
  userName: string;
  userEmail: string;
  /**
   * Remaining hours on the logged-in user's PERSONAL studio credits (the free
   * studio hour). When >= 1 AND the booking is solo, the review step offers a
   * toggle to apply one hour off the base studio time at checkout. 0 → no
   * toggle. Band bookings never show it.
   */
  freeHourBalance?: number;
  /** DB-driven engineer roster (active), filtered to the selected room for the picker. */
  engineers: readonly { name: string; displayName: string; specialties: string[]; studios: string[]; canBookBands?: boolean }[];
  /**
   * DB-driven room configs (studio_rooms) loaded server-side and passed in, so
   * admin edits to rates / hours / guest rules / surcharges / tiers cascade to
   * the booking UI AND match what /api/booking/create charges (same config layer,
   * proven byte-identical to the old constants by the golden round-trip).
   */
  studios: StudioConfig[];
  /**
   * When provided, the flow runs in "band mode":
   *   - room is locked to Studio A
   *   - duration is restricted to 4h or 8h
   *   - guest count is hidden (band members aren't guests)
   *   - pricing is a flat-rate package (no night / same-day stacking)
   *   - submit includes bandId so the server can attribute the booking
   *
   * Server re-verifies permission on submit — this prop alone doesn't
   * grant anything; it just shapes the UI.
   */
  band?: { id: string; display_name: string } | null;
}) {
  const isBandMode = !!band;

  // ── DB-driven config accessors (replace the old lib/constants reads) ──
  // `cfg` (current room) is derived just after the room state is declared below.
  const studioBySlug = useMemo(() => new Map(studios.map((s) => [s.slug, s])), [studios]);
  // Band tiers live on the band-enabled room (Studio A).
  const bandCfg = studioBySlug.get('studio_a') ?? studios.find((s) => s.bandEnabled) ?? studios[0];
  const bandTier = (h: number) => bandCfg.tiers.find((t) => t.kind === `band_${h}h`);
  const sweet4HoursFor = (c: StudioConfig) => c.tiers.find((t) => t.kind === 'sweet_4')?.hours ?? 4;

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  // Default duration depends on mode: solo defaults to 2h (classic);
  // band defaults to the smallest self-serve tier (4h).
  const [duration, setDuration] = useState<number>(isBandMode ? 4 : 2);
  // Band sessions are Studio A only — the state is locked below, but we
  // still initialize to studio_a to keep the initial pricing calc correct.
  const [room, setRoom] = useState<string>('studio_a');
  // Current room's full config + derived weekday-restriction helpers.
  const cfg = studioBySlug.get(room) ?? studios[0];
  const weekdayStart = cfg.weekdayStartHour; // null = no weekday restriction
  const weekdayStartLabel = weekdayStart != null ? formatTime(decimalToTimeStr(weekdayStart)) : null;
  // Surcharge amounts (cents) for this room — drive the legend + banners so an
  // admin's surcharge edits cascade everywhere, not just into the totals.
  const lateNightCents = cfg.surcharges.find((s) => s.kind === 'late_night')?.amountCents ?? 0;
  const deepNightCents = cfg.surcharges.find((s) => s.kind === 'deep_night')?.amountCents ?? 0;
  const sameDayCents = cfg.surcharges.find((s) => s.kind === 'same_day')?.amountCents ?? 0;

  // ── Band-only: Sweet Spot filming add-on ──────────────────────────
  // Toggle is shown when the band picks the 8hr or 24hr tier. For 24hr
  // (3-day block), the band ALSO picks which day (0|1|2) the +2hr filming
  // hours land on. Pricing per Cole 2026-04-28: $2,000 atop 8hr, $1,000
  // atop 3-day. Implementation lives on bookings.sweet_spot_addon JSONB
  // (migration 042). Note that toggling this also extends the row's
  // `duration` for the chosen day by 2 hrs of filming time after the
  // metered band hours — engineer arrives, band records, then films.
  const [sweetSpotAddon, setSweetSpotAddon] = useState(false);
  const [sweetSpotFilmingDay, setSweetSpotFilmingDay] = useState<0 | 1 | 2>(0);
  // Reset add-on state when the band switches to a tier that doesn't
  // support it (4hr) — otherwise stale state would leak into pricing.
  useEffect(() => {
    if (isBandMode && duration !== 8 && duration !== 24) {
      setSweetSpotAddon(false);
    }
  }, [isBandMode, duration]);
  const [engineer, setEngineer] = useState<string>('any');
  // Band sessions are open to band-eligible engineers (the picker below filters
  // to canBookBands). Reset the engineer choice whenever the mode flips so a
  // solo-only pick can't leak into a band booking (and vice-versa); the server
  // re-validates eligibility on submit regardless.
  useEffect(() => {
    setEngineer('any');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBandMode]);
  const [customerName, setCustomerName] = useState(userName);
  const [customerEmail] = useState(userEmail);
  const [customerPhone, setCustomerPhone] = useState('');
  // Number of GUESTS the customer brings (the artist is always free + NOT counted).
  // freeGuests/guestFee from the studio config use the same "guests" basis.
  const [guestCount, setGuestCount] = useState(0);
  const [notes, setNotes] = useState('');
  // Free studio hour opt-in. Default OFF. Only meaningful for solo bookings
  // when the user has >= 1 hour of personal credit (freeHourBalance >= 1).
  const [applyFreeHour, setApplyFreeHour] = useState(false);
  // Hide + force-off the toggle whenever it can't apply (band mode, no
  // balance) so stale state never leaks into a band booking's pricing/submit.
  const freeHourEligible = !isBandMode && freeHourBalance >= 1;
  useEffect(() => {
    if (!freeHourEligible && applyFreeHour) setApplyFreeHour(false);
  }, [freeHourEligible, applyFreeHour]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookedSlots, setBookedSlots] = useState<Record<string, number[]>>({});
  const [checkoutError, setCheckoutError] = useState('');

  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());

  // Month-level availability heat map data
  const [monthAvailability, setMonthAvailability] = useState<Record<string, { booked: number; total: number }>>({});

  const timeSlots = useMemo(() => generateTimeSlots(), []);

  const startHour = selectedTime ? parseTimeSlot(selectedTime) : 0;
  const isSameDayBooking = selectedDate ? isSameDay(selectedDate) : false;

  // Pricing branches on mode. Band sessions use flat-rate packages, so we
  // adapt the BandSessionPricing shape into SessionPricing (same fields,
  // zeros for the "no surcharge" entries, empty hourBreakdown so the
  // per-hour preview UI just collapses). This keeps the downstream JSX
  // from needing to know which mode it's in — it just reads pricing.*.
  const pricing = useMemo(() => {
    if (isBandMode && (duration === 4 || duration === 8 || duration === 24)) {
      // Sweet Spot only attaches to 8hr / 24hr tiers; 4hr ignores the add-on
      // state. priceBandFromConfig validates the addon/duration match internally.
      const addon = sweetSpotAddon
        ? duration === 8
          ? { kind: '8hr-addon' as const }
          : duration === 24
            ? { kind: '3day-addon' as const, filmingDayIndex: sweetSpotFilmingDay }
            : null
        : null;
      return priceBandFromConfig(bandCfg, duration, addon);
    }
    return priceSessionFromConfig(cfg, { hours: duration, startHour, sameDay: isSameDayBooking, guests: guestCount });
  }, [isBandMode, cfg, bandCfg, duration, startHour, isSameDayBooking, guestCount, sweetSpotAddon, sweetSpotFilmingDay]);

  // ── Free studio hour discount (display + submit) ───────────────────────
  // Mirrors /api/booking/create + lib/credit-redemption-pricing: one base hour
  // off at the SAME per-hour rate the base session uses (single-hour rate for a
  // 1-hour booking, multi-hour rate otherwise), capped at the session total so
  // surcharges are always paid. Solo only. The SERVER re-computes + re-validates
  // this against the live credit; this is preview math, kept identical so the
  // displayed total/deposit match what's charged.
  const freeHourActive = freeHourEligible && applyFreeHour;
  const freeHourApplicableRate = duration === 1 ? cfg.singleHourRateCents : cfg.hourlyRateCents;
  const freeHourDiscount = freeHourActive
    ? Math.min(freeHourApplicableRate, pricing.total)
    : 0;
  const effectiveTotal = Math.max(0, pricing.total - freeHourDiscount);
  const effectiveDeposit = freeHourActive
    ? Math.round(effectiveTotal * (cfg.depositPercent / 100))
    : pricing.deposit;

  // Fetch month-level availability for heat map coloring
  useEffect(() => {
    fetch(`/api/booking/availability/month?year=${calYear}&month=${calMonth}`)
      .then(res => res.json())
      .then(data => {
        if (data.days) {
          setMonthAvailability(data.days);
        }
      })
      .catch(() => {});
  }, [calYear, calMonth]);

  // Determine heat map status for a given day number in the current calendar month
  function getDayAvailability(day: number): 'past' | 'green' | 'yellow' | 'red' | 'none' {
    if (isPastDate(day)) return 'past';
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const info = monthAvailability[dateStr];
    if (!info) return 'none';
    const pctBooked = info.booked / info.total;
    if (pctBooked >= 0.85) return 'red';      // 85%+ booked = fully booked
    if (pctBooked >= 0.5) return 'yellow';     // 50-84% booked = limited
    return 'green';                             // <50% booked = plenty available
  }

  // Fetch availability when date changes (checks ALL studios since they can't overlap)
  useEffect(() => {
    if (!selectedDate) return;
    const dateStr = selectedDate.toISOString().split('T')[0];
    if (bookedSlots[dateStr] !== undefined) return; // already fetched

    fetch(`/api/booking/availability?date=${dateStr}`)
      .then(res => res.json())
      .then(data => {
        setBookedSlots(prev => ({ ...prev, [dateStr]: data.bookedSlots || [] }));
      })
      .catch(() => {});
  }, [selectedDate, bookedSlots]);

  // Get booked hours for current date (all studios)
  const currentBookedSlots = selectedDate
    ? bookedSlots[selectedDate.toISOString().split('T')[0]] || []
    : [];

  // Per-room weekday restriction: a room with weekdayStartHour set is only
  // bookable from that hour onward Mon-Fri (Studio A = 6:30 PM+ today).
  const isWeekday = selectedDate ? [1, 2, 3, 4, 5].includes(selectedDate.getDay()) : false;
  const studioARestricted = weekdayStart != null && isWeekday;

  // Check if a half-hour slot would conflict (slot is decimal, e.g. 18.5)
  function isSlotBooked(slot: number): boolean {
    if (currentBookedSlots.includes(slot)) return true;
    // Room blocked before its weekday start hour on weekdays
    if (studioARestricted && weekdayStart != null && slot < weekdayStart) return true;
    return false;
  }

  function wouldOverlap(startSlot: number, dur: number): boolean {
    // dur is in hours, each hour = 2 half-hour slots
    const halfHourCount = dur * 2;
    for (let i = 0; i < halfHourCount; i++) {
      const slot = (startSlot + i * 0.5) % 24;
      if (currentBookedSlots.includes(slot)) return true;
    }
    return false;
  }

  // Refs for auto-scrolling
  const timeRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  // Section visibility states for animation
  const [showTime, setShowTime] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [showReview, setShowReview] = useState(false);

  // Auto-reveal and scroll to next section
  // Step 2: Show studio selection after date is picked
  useEffect(() => {
    if (selectedDate && !showStudio) {
      setShowStudio(true);
      setTimeout(() => studioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [selectedDate, showStudio]);

  // Step 3: Show time selection after studio section is visible (studio has a default)
  useEffect(() => {
    if (showStudio && !showTime) {
      setShowTime(true);
      setTimeout(() => timeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [showStudio, showTime]);

  // Step 4: Show review after time is selected
  useEffect(() => {
    if (selectedTime && !showReview) {
      setShowReview(true);
      setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  }, [selectedTime, showReview]);

  // Re-scroll to review when pricing changes
  useEffect(() => {
    if (showReview) {
      setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, duration]);

  async function handleCheckout() {
    if (!selectedDate || !selectedTime || !customerName.trim()) return;
    setCheckoutError('');

    // Client-side overlap check
    if (wouldOverlap(startHour, duration)) {
      setCheckoutError('Your session overlaps with an existing booking. Please adjust your time or duration.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate.toISOString().split('T')[0],
          startTime: selectedTime,
          duration,
          // Band mode forces Studio A regardless of the room state —
          // belt-and-suspenders since the state is locked anyway.
          room: isBandMode ? 'studio_a' : room,
          engineer: engineer === 'any' ? null : engineer,
          customerName,
          customerEmail,
          customerPhone,
          // Server ignores guestCount for band bookings (no surcharge), but
          // we still send it so the solo path validation stays unchanged.
          guestCount,
          notes,
          // bandId is the only signal that this is a band booking. The
          // server re-verifies permission before trusting it.
          bandId: band?.id,
          // Sweet Spot filming add-on. Only meaningful when band mode +
          // 8hr or 24hr tier. Server re-validates the kind matches the
          // session length so a tampered POST can't get the wrong price.
          sweetSpotAddon: isBandMode && sweetSpotAddon && (duration === 8 || duration === 24)
            ? duration === 8
              ? { kind: '8hr-addon' as const }
              : { kind: '3day-addon' as const, filmingDayIndex: sweetSpotFilmingDay }
            : null,
          // Free studio hour opt-in. Solo only — only true when the user has a
          // balance AND toggled it on. The server re-validates against the live
          // credit and silently ignores it if ineligible (no crash, no discount).
          apply_free_hour: freeHourActive,
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutError(data.error || 'Failed to create checkout session');
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setCheckoutError('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  function isPastDate(day: number): boolean {
    const date = new Date(calYear, calMonth, day);
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return date < todayStart;
  }

  function isSelectedDate(day: number): boolean {
    if (!selectedDate) return false;
    return (
      selectedDate.getFullYear() === calYear &&
      selectedDate.getMonth() === calMonth &&
      selectedDate.getDate() === day
    );
  }

  return (
    <div className="space-y-16">
      {/* Band-mode context banner — makes it obvious the user is in a
          different flow than usual, and lets them bail to solo if they
          clicked the wrong link. The free-setup-hour disclosure lives
          here too so it's the first thing the band reads. */}
      {isBandMode && band && (
        <div className="border-2 border-black bg-yellow-300 p-4 sm:p-5 flex items-start gap-3">
          <Music2 className="w-5 h-5 text-black flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-mono text-sm font-bold uppercase tracking-wider">
              Booking for {band.display_name}
            </p>
            <p className="font-mono text-xs text-black/70 mt-1">
              Band sessions run in Studio A at a flat rate. You&apos;re the paying customer on file —
              invoices and confirmations come to your email.
            </p>
            <p className="font-mono text-xs text-black/80 mt-2 font-bold">
              ✓ Includes a <strong>free 1-hour setup window</strong> before your session — engineer
              arrives early to set up amps, mic the drums, etc. The clock on your booked hours
              starts at the time you pick.
            </p>
          </div>
        </div>
      )}

      {/* ============ SECTION 1: DATE ============ */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <span className="w-8 h-8 bg-black text-white font-mono text-sm font-bold flex items-center justify-center flex-shrink-0">1</span>
          <h2 className="text-heading-lg">SELECT A DATE</h2>
        </div>

        <div className="max-w-md">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => {
                if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                else setCalMonth(calMonth - 1);
              }}
              className="p-2 hover:bg-black/5 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-heading-sm">{MONTH_NAMES[calMonth]} {calYear}</h3>
            <button
              onClick={() => {
                if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                else setCalMonth(calMonth + 1);
              }}
              className="p-2 hover:bg-black/5 transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-6">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center font-mono text-xs text-black/40 uppercase py-2">{d}</div>
            ))}
            {Array.from({ length: getFirstDayOfMonth(calYear, calMonth) }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: getDaysInMonth(calYear, calMonth) }).map((_, i) => {
              const day = i + 1;
              const past = isPastDate(day);
              const selected = isSelectedDate(day);
              const avail = getDayAvailability(day);
              return (
                <button
                  key={day}
                  disabled={past}
                  onClick={() => setSelectedDate(new Date(calYear, calMonth, day))}
                  className={cn(
                    'aspect-square flex flex-col items-center justify-center font-mono text-sm transition-colors relative',
                    past && 'text-black/20 cursor-not-allowed',
                    !past && !selected && 'hover:bg-black/5 cursor-pointer',
                    selected && 'bg-black text-white',
                    // Heat map border coloring (not applied when selected or past)
                    !past && !selected && avail === 'green' && 'ring-2 ring-inset ring-emerald-400/60',
                    !past && !selected && avail === 'yellow' && 'ring-2 ring-inset ring-amber-400/60',
                    !past && !selected && avail === 'red' && 'ring-2 ring-inset ring-red-400/60',
                  )}
                >
                  {day}
                  {/* Availability dot indicator */}
                  {!past && avail !== 'none' && (
                    <span
                      className={cn(
                        'absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full',
                        avail === 'green' && 'bg-emerald-500',
                        avail === 'yellow' && 'bg-amber-500',
                        avail === 'red' && 'bg-red-500',
                        selected && 'opacity-80',
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Availability heat map legend */}
          <div className="flex flex-wrap gap-4 mb-4 font-mono text-[10px] uppercase tracking-wider text-black/70">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Available</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Limited</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Fully Booked</span>
          </div>

          {selectedDate && (
            <div className="font-mono text-sm text-black/60">
              Selected: <strong className="text-black">
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </strong>
              {isSameDay(selectedDate) && (
                <span className="block text-amber-600 text-xs mt-1">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  Same-day booking: +{formatCents(sameDayCents)}/hr surcharge applies
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ============ SECTION 2: STUDIO & ENGINEER ============ */}
      <section
        ref={studioRef}
        className={cn(
          'transition-all duration-700 ease-out scroll-mt-8',
          showStudio ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none h-0 overflow-hidden'
        )}
      >
        <div className="flex items-center gap-3 mb-6">
          <span className="w-8 h-8 bg-black text-white font-mono text-sm font-bold flex items-center justify-center flex-shrink-0">2</span>
          <h2 className="text-heading-lg">STUDIO & ENGINEER</h2>
        </div>

        <div className="mb-8">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
            {isBandMode ? 'Studio (Locked)' : 'Select Studio'}
          </h3>
          {isBandMode ? (
            // Band sessions are Studio A only — show a single locked card
            // so the user knows the choice is deliberate, not absent.
            <div className="p-6 border-2 border-black bg-black text-white font-mono max-w-sm">
              <Home className="w-6 h-6 mb-3 text-accent" />
              <p className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                {bandCfg.displayName}
                <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded">BAND</span>
              </p>
              <p className="text-xs mt-1 text-white/80">
                Flat-rate package — all-in pricing, no surcharges
              </p>
              {bandCfg.weekdayStartHour != null && (
                <p className="text-[10px] mt-2 text-amber-300">
                  Weekdays {formatTime(decimalToTimeStr(bandCfg.weekdayStartHour))}+ only
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {studios.map((s) => (
                <button
                  key={s.slug}
                  onClick={() => {
                    setRoom(s.slug);
                    setEngineer('any');
                    // Clear the selected time if switching to a room whose weekday
                    // start hour would make the current pick unavailable.
                    if (s.weekdayStartHour != null && isWeekday && selectedTime) {
                      if (parseTimeSlot(selectedTime) < s.weekdayStartHour) setSelectedTime(null);
                    }
                  }}
                  className={cn(
                    'p-6 border-2 font-mono text-left transition-colors',
                    room === s.slug ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black'
                  )}
                >
                  <Home className={cn('w-6 h-6 mb-3', room === s.slug ? 'text-accent' : 'text-black/40')} />
                  <p className="font-bold text-sm uppercase tracking-wider">{s.displayName}</p>
                  <p className={cn('text-xs mt-1', room === s.slug ? 'text-white/80' : 'text-black/60')}>
                    {formatCents(s.hourlyRateCents)}/hour
                    <span className="block text-[10px] mt-0.5">1hr: {formatCents(s.singleHourRateCents)}</span>
                    {s.weekdayStartHour != null && (
                      <span className={cn('block text-[10px] mt-1', room === s.slug ? 'text-amber-300' : 'text-amber-600')}>
                        Weekdays {formatTime(decimalToTimeStr(s.weekdayStartHour))}+ only
                      </span>
                    )}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {isBandMode ? (
          // Band sessions are run by our band-experienced engineers (canBookBands).
          <div className="mb-4">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
              Request a Band Engineer <span className="font-normal text-black/60">(not guaranteed)</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setEngineer('any')}
                className={cn(
                  'p-4 border-2 font-mono text-sm text-left transition-colors',
                  engineer === 'any' ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black'
                )}
              >
                <p className="font-bold uppercase tracking-wider">Any Available</p>
                <p className={cn('text-xs mt-1', engineer === 'any' ? 'text-white/80' : 'text-black/60')}>
                  We&apos;ll match a band engineer
                </p>
              </button>
              {engineers.filter((eng) => eng.canBookBands).map((eng) => (
                <button
                  key={eng.name}
                  onClick={() => setEngineer(eng.name)}
                  className={cn(
                    'p-4 border-2 font-mono text-sm text-left transition-colors',
                    engineer === eng.name ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black'
                  )}
                >
                  <p className="font-bold uppercase tracking-wider">{eng.displayName}</p>
                  <p className={cn('text-xs mt-1', engineer === eng.name ? 'text-white/80' : 'text-black/60')}>
                    {eng.specialties.join(', ') || 'Band sessions'}
                  </p>
                </button>
              ))}
            </div>
            <p className="font-mono text-xs text-black/50 mt-3">
              Your band engineer will reach out to confirm and coordinate the day.
            </p>
          </div>
        ) : (
          <div className="mb-4">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
              Request an Engineer <span className="font-normal text-black/60">(not guaranteed)</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setEngineer('any')}
                className={cn(
                  'p-4 border-2 font-mono text-sm text-left transition-colors',
                  engineer === 'any' ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black'
                )}
              >
                <p className="font-bold uppercase tracking-wider">Any Available</p>
                <p className={cn('text-xs mt-1', engineer === 'any' ? 'text-white/80' : 'text-black/60')}>
                  We&apos;ll match you
                </p>
              </button>
              {engineers.filter((eng) => eng.studios.includes(room)).map((eng) => (
                <button
                  key={eng.name}
                  onClick={() => setEngineer(eng.name)}
                  className={cn(
                    'p-4 border-2 font-mono text-sm text-left transition-colors',
                    engineer === eng.name ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black'
                  )}
                >
                  <p className="font-bold uppercase tracking-wider">{eng.displayName}</p>
                  <p className={cn('text-xs mt-1', engineer === eng.name ? 'text-white/80' : 'text-black/60')}>
                    {eng.specialties.join(', ')}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ============ SECTION 3: TIME & DURATION ============ */}
      <section
        ref={timeRef}
        className={cn(
          'transition-all duration-700 ease-out scroll-mt-8',
          showTime ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none h-0 overflow-hidden'
        )}
      >
        <div className="flex items-center gap-3 mb-6">
          <span className="w-8 h-8 bg-black text-white font-mono text-sm font-bold flex items-center justify-center flex-shrink-0">3</span>
          <h2 className="text-heading-lg">CHOOSE YOUR TIME</h2>
        </div>

        {/* Time slots */}
        <div className="mb-8">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-2">Start Time</h3>
          <p className="font-mono text-xs text-black/60 mb-4">
            Open 24 hours. Surcharges apply for late night and after-hours bookings.
          </p>
          {studioARestricted && (
            <p className="font-mono text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 mb-4">
              {cfg.displayName} is available {weekdayStartLabel} and later on weekdays. Available all day on weekends.
            </p>
          )}
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {timeSlots.map((slot) => {
              const slotDec = parseTimeSlot(slot);
              const surcharge = hourSurchargeFromConfig(cfg, slotDec);
              const booked = isSlotBooked(slotDec);
              return (
                <button
                  key={slot}
                  onClick={() => !booked && setSelectedTime(slot)}
                  disabled={booked}
                  className={cn(
                    'px-2 py-3 font-mono text-xs border transition-colors text-center',
                    booked && 'bg-black/10 text-black/30 border-black/10 cursor-not-allowed line-through',
                    !booked && selectedTime === slot
                      ? 'bg-black text-white border-black'
                      : !booked && 'border-black/20 hover:border-black',
                    !booked && surcharge.tier === 'lateNight' && selectedTime !== slot && 'border-amber-400/50 bg-amber-50',
                    !booked && surcharge.tier === 'deepNight' && selectedTime !== slot && 'border-red-400/50 bg-red-50'
                  )}
                >
                  {booked
                    ? (studioARestricted && weekdayStart != null && slotDec < weekdayStart ? 'Unavail.' : 'Booked')
                    : formatTime(slot)}
                  {!booked && surcharge.tier === 'lateNight' && (
                    <span className="block text-[9px] text-amber-600 font-semibold mt-0.5">+{formatCents(surcharge.amount)}/hr</span>
                  )}
                  {!booked && surcharge.tier === 'deepNight' && (
                    <span className="block text-[9px] text-red-500 font-semibold mt-0.5">+{formatCents(surcharge.amount)}/hr</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4 font-mono text-[10px] uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 border border-black/20 inline-block" /> Regular</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-amber-50 border border-amber-400/50 inline-block" /> Late Night +{formatCents(lateNightCents)}/hr</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-red-50 border border-red-400/50 inline-block" /> After Hours +{formatCents(deepNightCents)}/hr</span>
          </div>
        </div>

        {/* Duration */}
        <div className="mb-4">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
            Duration: {duration} hour{duration > 1 ? 's' : ''}
            {isBandMode ? (
              <span className="text-accent ml-2 inline-flex items-center gap-1">
                <Music2 className="w-3 h-3" /> Band Tier ({formatCents(bandTier(duration)?.priceCents || 0)})
              </span>
            ) : (
              <>
                {duration === sweet4HoursFor(cfg) && (
                  <span className="text-accent ml-2 inline-flex items-center gap-1"><Star className="w-3 h-3" /> The Sweet 4!</span>
                )}
                {duration === 3 && (
                  <span className="text-accent ml-2 inline-flex items-center gap-1"><Video className="w-3 h-3" /> Free short-form video included</span>
                )}
              </>
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            {/* Band mode: 4 / 8 / 24 (3-day) tiers. The 24h tier renders as
                "3 Days" with a slightly different label so the user knows
                their pick is Day 1 of three. Solo path: 1..maxHours. */}
            {isBandMode
              ? BAND_DURATIONS.map((h) => {
                  const tier = bandTier(h);
                  const headline = h === 24 ? '3 Days' : `${h} hours`;
                  return (
                    <button
                      key={h}
                      onClick={() => setDuration(h)}
                      className={cn(
                        'px-5 py-4 font-mono text-left border-2 transition-colors',
                        duration === h ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
                      )}
                    >
                      <p className="text-lg font-bold">{headline}</p>
                      <p className={cn('text-xs mt-0.5', duration === h ? 'text-white/80' : 'text-black/60')}>
                        {formatCents(tier?.priceCents || 0)} · {tier?.note}
                      </p>
                    </button>
                  );
                })
              : Array.from({ length: cfg.maxHours }, (_, i) => i + 1).map((h) => (
                  <button
                    key={h}
                    onClick={() => setDuration(h)}
                    className={cn(
                      'w-14 h-14 font-mono text-lg font-bold border transition-colors relative',
                      duration === h ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
                    )}
                  >
                    {h}
                    {h === sweet4HoursFor(cfg) && duration !== h && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-accent rounded-full" />
                    )}
                  </button>
                ))}
          </div>

          {/* 2-hour → 3-hour upsell nudge: adding one hour unlocks a free
              short-form video. Solo only — band packages already include
              everything, and 24h bookings go through contact, not upsell. */}
          {!isBandMode && duration === 2 && (
            <div className="mt-4 bg-yellow-300 border-2 border-black p-4 flex items-start gap-3">
              <Video className="w-5 h-5 text-black flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-mono text-sm font-bold uppercase tracking-wider mb-1">
                  Add 1 hour — get a free short-form video
                </p>
                <p className="font-mono text-xs text-black/80 mb-3">
                  Every 3-hour session includes a free short-form video deliverable for reels, shorts, or feed — shot while you record.
                </p>
                <button
                  type="button"
                  onClick={() => setDuration(3)}
                  className="bg-black text-yellow-300 font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black/80 transition-colors"
                >
                  Bump to 3 hours
                </button>
              </div>
            </div>
          )}

          {/* Band-mode 3-day notice: when the 24hr tier is selected, the
              picked date acts as Day 1 — the studio is reserved for the
              following two days at the same time slot. We follow up by
              phone after deposit clears to lock the rest of the logistics
              (engineer per day, gear, breaks). The conflict check on the
              date picker validates all 3 days are free at the chosen time. */}
          {isBandMode && duration === 24 && (
            <div className="mt-4 border-2 border-accent bg-accent/10 p-4 flex items-start gap-3">
              <Calendar className="w-5 h-5 text-black flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-mono text-sm font-bold uppercase tracking-wider mb-1">
                  3-day block — your pick is Day 1
                </p>
                <p className="font-mono text-xs text-black/70">
                  We&apos;ll reserve the same time on the next two consecutive days.
                  Once your deposit clears, our team will <strong>call you to confirm</strong> day-by-day
                  details — engineer per day, gear logistics, breaks. The free 1-hour
                  setup runs before Day 1 only.
                </p>
              </div>
            </div>
          )}

          {/* Sweet Spot filming add-on. Only shown when an 8hr or 24hr tier
              is picked. For 24hr, an additional day picker appears so the
              band can choose which of the 3 days the +2hr filming hours
              are appended to (filming runs at the END of that day's
              session). */}
          {isBandMode && (duration === 8 || duration === 24) && (
            <div className={cn(
              'mt-4 border-2 p-4 transition-colors',
              sweetSpotAddon ? 'border-accent bg-accent/10' : 'border-black/20',
            )}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="sweet-spot-addon"
                  checked={sweetSpotAddon}
                  onChange={(e) => setSweetSpotAddon(e.target.checked)}
                  className="mt-1 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="sweet-spot-addon" className="flex-1 cursor-pointer">
                  <p className="font-mono text-sm font-bold uppercase tracking-wider mb-1">
                    Add Sweet Spot filming &nbsp;
                    <span className="text-accent">
                      + {formatCents(sweetSpotAddonCents(bandCfg, duration))}
                    </span>
                  </p>
                  <p className="font-mono text-xs text-black/70">
                    Multicam live-band video at the end of your session — we add
                    <strong> 2 hours of filming time</strong>{' '}
                    {duration === 8 ? 'after your 8hr block.' : 'after one of your 8hr session days.'}{' '}
                    Two songs mixed, short-form clips, featured on Sweet Dreams YouTube.
                    {duration === 24 && ' Pick the day below.'}
                  </p>
                </label>
              </div>

              {/* Day picker — only when 24hr Sweet Spot is enabled */}
              {sweetSpotAddon && duration === 24 && (
                <div className="mt-4 pt-4 border-t border-accent/30">
                  <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-2">
                    Which day for the filming?
                  </p>
                  <div className="flex gap-2">
                    {([0, 1, 2] as const).map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSweetSpotFilmingDay(idx)}
                        className={cn(
                          'flex-1 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider border-2 transition-colors',
                          sweetSpotFilmingDay === idx
                            ? 'bg-black text-white border-black'
                            : 'border-black/20 hover:border-black bg-white',
                        )}
                      >
                        Day {idx + 1}
                      </button>
                    ))}
                  </div>
                  <p className="font-mono text-[11px] text-black/50 mt-2">
                    Filming hours run at the END of Day {sweetSpotFilmingDay + 1}, after the
                    band session wraps. Day {sweetSpotFilmingDay + 1} reserves a 10-hour slot
                    instead of 8.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live hour-by-hour preview when time is selected. Hidden in
            band mode — flat-rate packages have no per-hour surcharges to
            preview, so the whole widget is noise. */}
        {selectedTime && !isBandMode && (
          <div className="mt-6 border border-black/10 p-4">
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-black/70 mb-3">Hour-by-Hour Preview</h4>
            <div className="space-y-1">
              {pricing.hourBreakdown.map((hb, i) => (
                <div key={i} className="flex items-center justify-between font-mono text-xs py-1.5 border-b border-black/5 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-black/60 w-20">{formatTime(decimalToTimeStr(hb.hour))}</span>
                    {hb.tier !== 'regular' && (
                      <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5', tierColor(hb.tier),
                        hb.tier === 'lateNight' ? 'bg-amber-50' : 'bg-red-50'
                      )}>
                        {tierLabel(hb.tier)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {hb.nightFee > 0 && (
                      <span className={cn('text-[10px]', tierColor(hb.tier))}>+{formatCents(hb.nightFee)}</span>
                    )}
                    {hb.sameDayFee > 0 && (
                      <span className="text-[10px] text-amber-600">+{formatCents(hb.sameDayFee)} same-day</span>
                    )}
                    <span className="font-semibold w-16 text-right">{formatCents(hb.hourTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ============ SECTION 4: REVIEW & PAY ============ */}
      <section
        ref={reviewRef}
        className={cn(
          'transition-all duration-700 ease-out scroll-mt-8',
          showReview ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none h-0 overflow-hidden'
        )}
      >
        <div className="flex items-center gap-3 mb-6">
          <span className="w-8 h-8 bg-black text-white font-mono text-sm font-bold flex items-center justify-center flex-shrink-0">4</span>
          <h2 className="text-heading-lg">REVIEW & PAY DEPOSIT</h2>
        </div>

        {/* Cost Breakdown */}
        <div className="border-2 border-black p-6 sm:p-8 mb-8">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">Session Summary</h3>
          <div className="space-y-3 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-black/60">Date</span>
              <span className="font-semibold">
                {selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/60">Time</span>
              <span className="font-semibold">
                {selectedTime && formatTime(selectedTime)}
                {selectedTime && ` – ${formatTime(decimalToTimeStr((startHour + duration) % 24))}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/60">Duration</span>
              <span className="font-semibold">{duration} hour{duration > 1 ? 's' : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/60">Studio</span>
              <span className="font-semibold">{cfg.displayName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/60">Engineer</span>
              <span className="font-semibold">{engineer === 'any' ? 'Any Available' : engineer}</span>
            </div>
          </div>

          <hr className="border-black/10 my-6" />

          {/* Detailed price breakdown */}
          <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-black/70 mb-3">Price Breakdown</h4>
          <div className="space-y-2 font-mono text-sm">
            {/* Base rate — different copy per mode. Band shows the tier
                label from the band-room config tier ("8 Hours · $85/hour")
                because that's what the customer was quoted on /pricing. */}
            <div className="flex justify-between">
              <span className="text-black/60">
                {isBandMode
                  ? `Band Session — ${bandTier(duration)?.label} (${bandTier(duration)?.note})`
                  : pricing.sweetSpot
                    ? `${cfg.displayName} The Sweet 4 (${duration}hr flat rate)`
                    : `${cfg.displayName} (${duration}hr × ${formatCents(duration === 1 ? cfg.singleHourRateCents : cfg.hourlyRateCents)})`
                }
              </span>
              <span>{formatCents(pricing.subtotal)}</span>
            </div>
            {pricing.sweetSpot && !isBandMode && (
              <div className="flex justify-between text-green-700">
                <span className="flex items-center gap-1"><Star className="w-3 h-3" /> The Sweet 4 savings</span>
                <span>-{formatCents(cfg.hourlyRateCents * duration - pricing.subtotal)}</span>
              </div>
            )}

            {/* Night surcharges — show per-hour detail */}
            {pricing.nightFees > 0 && (
              <div className="border-l-2 border-amber-400 pl-3 ml-1 space-y-1 py-1">
                {pricing.hourBreakdown
                  .filter((hb) => hb.nightFee > 0)
                  .map((hb, i) => (
                    <div key={i} className={cn('flex justify-between text-xs', tierColor(hb.tier))}>
                      <span>{formatTime(decimalToTimeStr(hb.hour))} — {tierLabel(hb.tier)}</span>
                      <span>+{formatCents(hb.nightFee)}</span>
                    </div>
                  ))
                }
                <div className="flex justify-between text-sm font-semibold pt-1 border-t border-black/5">
                  <span>Night surcharges total</span>
                  <span>+{formatCents(pricing.nightFees)}</span>
                </div>
              </div>
            )}

            {/* Same-day */}
            {pricing.sameDayFee > 0 && (
              <div className="flex justify-between text-amber-700">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Same-day surcharge ({duration}hr × {formatCents(sameDayCents)})
                </span>
                <span>+{formatCents(pricing.sameDayFee)}</span>
              </div>
            )}

            {/* Guest fee */}
            {pricing.guestFee > 0 && (
              <div className="flex justify-between text-amber-700">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  Extra guest fee ({guestCount - cfg.freeGuests} extra × {duration}hr × {formatCents(cfg.guestFeeCents)})
                </span>
                <span>+{formatCents(pricing.guestFee)}</span>
              </div>
            )}
          </div>

          {/* Free studio hour toggle. Solo only, shown when the user has a
              balance. Default OFF. Turning it on subtracts one base hour at the
              session's per-hour rate (surcharges still paid) and recomputes the
              deposit on the discounted total. */}
          {freeHourEligible && (
            <>
              <hr className="border-black/10 my-6" />
              <div className={cn(
                'border-2 p-4 transition-colors',
                freeHourActive ? 'border-accent bg-accent/10' : 'border-black/20',
              )}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="apply-free-hour"
                    checked={applyFreeHour}
                    onChange={(e) => setApplyFreeHour(e.target.checked)}
                    className="mt-1 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="apply-free-hour" className="flex-1 cursor-pointer">
                    <p className="font-mono text-sm font-bold uppercase tracking-wider mb-1">
                      Apply your free studio hour&nbsp;
                      <span className="text-accent">
                        − {formatCents(Math.min(freeHourApplicableRate, pricing.total))} off
                      </span>
                    </p>
                    <p className="font-mono text-xs text-black/70">
                      Covers 1 hour of studio time. You still pay any surcharges
                      (late night / same-day / guests) and the rest of your session.
                      {' '}You have <strong>{freeHourBalance} free hour{freeHourBalance > 1 ? 's' : ''}</strong> available — this uses 1.
                    </p>
                  </label>
                </div>
              </div>
            </>
          )}

          <hr className="border-black/10 my-6" />

          {/* Totals */}
          <div className="space-y-3 font-mono text-sm">
            {freeHourActive && (
              <>
                <div className="flex justify-between text-black/60">
                  <span>Session Subtotal</span>
                  <span>{formatCents(pricing.total)}</span>
                </div>
                <div className="flex justify-between text-green-700">
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3" /> Free studio hour applied
                  </span>
                  <span>−{formatCents(freeHourDiscount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-lg">
              <span className="font-semibold">Session Total</span>
              <span className="font-bold">{formatCents(effectiveTotal)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold">
              <span>Deposit Due Now ({cfg.depositPercent}%)</span>
              <span className="text-accent">{formatCents(effectiveDeposit)}</span>
            </div>
            <p className="text-xs text-black/60 mt-2">
              Remainder ({formatCents(effectiveTotal - effectiveDeposit)}) charged to your card on file after your session.
            </p>
          </div>
        </div>

        {/* Contact Info */}
        <div className="space-y-4 mb-8">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-wider">Your Info</h3>
          <div>
            <label htmlFor="customerName" className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Name *</label>
            <input type="text" id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required
              className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none" placeholder="Your name" />
          </div>
          <div>
            <label htmlFor="customerEmail" className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Email</label>
            <input type="email" id="customerEmail" value={customerEmail} readOnly
              className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm bg-black/5 text-black/60 cursor-not-allowed" />
          </div>
          <div>
            <label htmlFor="customerPhone" className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Phone</label>
            <input type="tel" id="customerPhone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
              className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none" placeholder="(555) 123-4567" />
          </div>
          {/* Guest count is solo-only. The band IS the guest list — the
              package is all-in, and adding a "how many band members?"
              field here would just invite confusion. */}
          {!isBandMode && (
            <div>
              <label htmlFor="guestCount" className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">
                How many guests are you bringing? *
              </label>
              <select id="guestCount" value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value))}
                className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none">
                {Array.from({ length: cfg.maxGuests }, (_, i) => i).map((guests) => {
                  // freeGuests = number of FREE guests; the artist is always free + never counted.
                  const extra = Math.max(0, guests - cfg.freeGuests);
                  return (
                    <option key={guests} value={guests}>
                      {guests === 0
                        ? 'No guests — just me'
                        : extra === 0
                          ? `${guests} guest${guests > 1 ? 's' : ''} (free)`
                          : `${guests} guest${guests > 1 ? 's' : ''} (+${formatCents(cfg.guestFeeCents * extra)}/hr for ${extra} extra)`
                      }
                    </option>
                  );
                })}
              </select>
              {guestCount > cfg.freeGuests && (
                <p className="font-mono text-xs text-amber-700 mt-1">
                  {guestCount - cfg.freeGuests} extra guest{guestCount - cfg.freeGuests > 1 ? 's' : ''} beyond the included {cfg.freeGuests} free — {formatCents(cfg.guestFeeCents)}/hr each = {formatCents(pricing.guestFee)} added to your session
                </p>
              )}
            </div>
          )}
          <div>
            <label htmlFor="notes" className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Notes</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-vertical" placeholder="Anything we should know..." />
          </div>
        </div>

        {/* Overlap warning */}
        {selectedTime && wouldOverlap(startHour, duration) && (
          <div className="border-2 border-red-500 bg-red-50 p-4 mb-4 font-mono text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            Your session overlaps with an existing booking. Please adjust your start time or duration.
          </div>
        )}

        {checkoutError && (
          <div className="border-2 border-red-500 bg-red-50 p-4 mb-4 font-mono text-sm text-red-700">
            {checkoutError}
          </div>
        )}

        {/* Pay button — label shifts to call out the band-session framing. */}
        <button
          onClick={handleCheckout}
          disabled={!selectedDate || !selectedTime || !customerName.trim() || isSubmitting || (selectedTime ? wouldOverlap(startHour, duration) : false)}
          className="w-full bg-accent text-black font-mono text-lg font-bold uppercase tracking-wider px-8 py-5 hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting
            ? 'PROCESSING...'
            : isBandMode
              ? `PAY BAND DEPOSIT — ${formatCents(pricing.deposit)}`
              : `PAY DEPOSIT — ${formatCents(effectiveDeposit)}`}
        </button>
      </section>
    </div>
  );
}
