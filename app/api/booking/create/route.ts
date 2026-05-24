import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { PRICING, SITE_URL, ROOM_LABELS, STUDIO_A_WEEKDAY_START, MAX_GUESTS, type Room } from '@/lib/constants';
import { calculateSessionTotal, calculateBandSessionTotal, isSelfServeBandHours, parseTimeSlot, formatDuration } from '@/lib/utils';
import { memberHasFlag } from '@/lib/bands';
import { getMembership } from '@/lib/bands-server';
import { isEngineerBlocked } from '@/lib/engineer-blocks';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, startTime, duration, room, engineer: rawEngineer, customerName, customerEmail: bodyCustomerEmail, customerPhone, guestCount: rawGuestCount, notes, bandId, sweetSpotAddon: rawSweetSpotAddon } = body;
    const guestCount = Math.min(Math.max(1, Number(rawGuestCount) || 1), MAX_GUESTS);
    const isBandBooking = typeof bandId === 'string' && bandId.length > 0;
    // Band sessions ALWAYS route to Iszac — he's the dedicated band engineer.
    // Server-side enforcement matters here because the body is otherwise the
    // booker's word; without this override a tampered POST or stale UI state
    // could route a band priority alert to the wrong engineer.
    const requestedEngineer: string = isBandBooking
      ? 'Iszac Griner'
      : typeof rawEngineer === 'string'
        ? rawEngineer
        : '';

    // Sweet Spot filming add-on validation. Only meaningful for band bookings
    // on the 8hr or 24hr (3-day) tier. Server re-validates the kind matches
    // the duration so a tampered POST can't smuggle the cheaper $1k tier
    // onto a single 8hr session, etc.
    let sweetSpotAddon: { kind: '8hr-addon' } | { kind: '3day-addon'; filmingDayIndex: 0 | 1 | 2 } | null = null;
    if (isBandBooking && rawSweetSpotAddon && typeof rawSweetSpotAddon === 'object') {
      const dur = Number(duration);
      if (rawSweetSpotAddon.kind === '8hr-addon' && dur === 8) {
        sweetSpotAddon = { kind: '8hr-addon' };
      } else if (rawSweetSpotAddon.kind === '3day-addon' && dur === 24) {
        const idx = rawSweetSpotAddon.filmingDayIndex;
        if (idx === 0 || idx === 1 || idx === 2) {
          sweetSpotAddon = { kind: '3day-addon', filmingDayIndex: idx };
        }
      }
      // Silently drop invalid combos — don't error, just charge the base
      // band session price. UI shouldn't allow this state.
    }

    if (!date || !startTime || !duration || !room || !customerName || !bodyCustomerEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Strict email format check — prevents garbage strings from becoming
    // Stripe customer records and downstream receipt emails.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof bodyCustomerEmail !== 'string' || !EMAIL_RE.test(bodyCustomerEmail.trim())) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    // IDENTITY POLICY:
    //   - Solo bookings are OPEN (first-time customers don't have accounts yet).
    //   - If the booker IS signed in, we prefer their verified session email
    //     over whatever is in the body. This closes a hole where a signed-in
    //     user with an unpaid balance could type a different email to bypass
    //     the unpaid-balance check below.
    //   - Band bookings always require auth (handled in the `isBandBooking`
    //     block below).
    const sessionUser = await getSessionUser();
    const customerEmail = sessionUser?.email
      ? sessionUser.email
      : bodyCustomerEmail.trim().toLowerCase();

    // Band bookings: require authentication, membership, and can_book_band_sessions.
    // We verify via the session cookie — NOT by trusting anything in the body.
    // The permission check is what gives band_id any meaning; everything else
    // trusts the body (customer email, name, phone) because it's a solo-style
    // self-attestation by the booker.
    let band: { id: string; display_name: string } | null = null;
    if (isBandBooking) {
      // Band bookings still require auth — reuse sessionUser loaded above.
      if (!sessionUser) {
        return NextResponse.json({ error: 'Sign in required to book a band session' }, { status: 401 });
      }
      const membership = await getMembership(bandId, sessionUser.id);
      if (!membership || !memberHasFlag(membership, 'can_book_band_sessions')) {
        return NextResponse.json({ error: 'You don\'t have permission to book sessions for this band' }, { status: 403 });
      }
      const supabase = createServiceClient();
      const { data: bandRow } = await supabase
        .from('bands')
        .select('id, display_name')
        .eq('id', bandId)
        .maybeSingle();
      if (!bandRow) {
        return NextResponse.json({ error: 'Band not found' }, { status: 404 });
      }
      band = bandRow as { id: string; display_name: string };

      // Band sessions are Studio A only (BAND_PRICING is Studio A).
      if (room !== 'studio_a') {
        return NextResponse.json({ error: 'Band sessions are Studio A only' }, { status: 400 });
      }
      // Self-serve band tiers: 4h, 8h, or 24h (3-day block). The 24h tier
      // checks out the same Stripe deposit but the webhook fans out to 3
      // booking rows linked by booking_group_id.
      if (!isSelfServeBandHours(Number(duration))) {
        return NextResponse.json({ error: 'Band sessions must be 4, 8, or 24 hours.' }, { status: 400 });
      }
    } else {
      // Solo flow — unchanged bounds.
      if (duration < PRICING.minHours || duration > PRICING.maxHours) {
        return NextResponse.json({ error: 'Invalid duration' }, { status: 400 });
      }
    }

    const startHour = parseTimeSlot(startTime);

    // Studio A weekday restriction: only available 6:30 PM+ on Mon-Fri
    if (room === 'studio_a') {
      const [y, m, d] = date.split('-').map(Number);
      const bookingDate = new Date(y, m - 1, d);
      const dow = bookingDate.getDay(); // 0=Sun, 1-5=Mon-Fri, 6=Sat
      if (dow >= 1 && dow <= 5 && startHour < STUDIO_A_WEEKDAY_START) {
        return NextResponse.json({ error: 'Studio A is only available 6:30 PM and later on weekdays. Try Studio B or choose an evening time.' }, { status: 400 });
      }
    }

    // Server-side double-booking check using half-hour slots
    const supabase = createServiceClient();
    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('start_time, duration, room')
      .gte('start_time', `${date}T00:00:00`)
      .lte('start_time', `${date}T23:59:59`)
      .in('status', ['confirmed', 'pending']);

    if (existingBookings && existingBookings.length > 0) {
      const requestedSlots = Array.from({ length: duration * 2 }, (_, i) => (startHour + i * 0.5) % 24);
      for (const booking of existingBookings) {
        const bt = new Date(booking.start_time);
        const bookedStart = bt.getUTCHours() + bt.getUTCMinutes() / 60;
        const bookedSlots = Array.from({ length: (booking.duration || 1) * 2 }, (_, i) => (bookedStart + i * 0.5) % 24);
        const overlap = requestedSlots.some(s => bookedSlots.includes(s));
        if (overlap) {
          return NextResponse.json({ error: 'This time slot is already booked. Please choose a different time.' }, { status: 409 });
        }
      }
    }

    // Engineer-specific availability check. If the buyer requested a
    // specific engineer (or band-mode forced Iszac), we reject the booking
    // when that engineer has self-blocked the window. "Any Available"
    // bookings skip this — the priority claim flow will route around
    // blocked engineers naturally.
    if (requestedEngineer) {
      const endDec = (startHour + Number(duration)) % 24;
      const endTimeForCheck = `${Math.floor(endDec)}:${endDec % 1 >= 0.5 ? '30' : '00'}`;
      const startISO = `${date}T${startTime}:00+00:00`;
      const endISO = `${date}T${endTimeForCheck.padStart(5, '0')}:00+00:00`;
      const blocked = await isEngineerBlocked({
        engineerName: requestedEngineer,
        startISO,
        endISO,
      });
      if (blocked) {
        const friendlyMsg = isBandBooking
          ? `Iszac is blocked off for that time. Pick a different date or time — band sessions are dedicated to him.`
          : `${requestedEngineer} is unavailable for that time. Pick a different time, choose another engineer, or select "Any Available".`;
        return NextResponse.json({ error: friendlyMsg }, { status: 409 });
      }
    }
    // Same-day check using date strings to avoid UTC timezone mismatch
    // Vercel runs UTC, studio is in Fort Wayne (America/Indiana/Indianapolis)
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Indiana/Indianapolis' });
    const sameDayBooking = date === todayLocal;

    // 3-hour buffer for same-day bookings
    if (sameDayBooking) {
      const nowFW = new Date().toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' });
      const nowDate = new Date(nowFW);
      const currentDecimal = nowDate.getHours() + nowDate.getMinutes() / 60;
      const bufferCutoff = Math.ceil((currentDecimal + 3) * 2) / 2; // round up to next 30-min
      if (startHour < bufferCutoff) {
        return NextResponse.json({ error: `Same-day bookings require a 3-hour buffer. The earliest available time is ${Math.floor(bufferCutoff)}:${bufferCutoff % 1 >= 0.5 ? '30' : '00'} ${bufferCutoff >= 12 ? 'PM' : 'AM'}.` }, { status: 400 });
      }
    }

    // Check for unpaid balance from previous sessions
    const { data: unpaidBookings } = await supabase
      .from('bookings')
      .select('id, remainder_amount')
      .eq('customer_email', customerEmail)
      .eq('status', 'completed')
      .gt('remainder_amount', 0)
      .limit(1);

    if (unpaidBookings && unpaidBookings.length > 0) {
      return NextResponse.json({
        error: `You have an unpaid balance from a previous session. Please pay your outstanding balance before booking a new session.`,
      }, { status: 400 });
    }

    // Branch pricing on booking type. Band bookings are flat-rate packages
    // (no night / same-day / guest surcharges stack); solo sessions keep the
    // full per-hour surcharge matrix.
    const pricing = isBandBooking
      ? calculateBandSessionTotal(Number(duration) as 4 | 8 | 24, sweetSpotAddon)
      : calculateSessionTotal(room as Room, duration, startHour, sameDayBooking, guestCount);

    const endDec = (startHour + duration) % 24;
    const endTime = `${Math.floor(endDec)}:${endDec % 1 >= 0.5 ? '30' : '00'}`;
    const roomLabel = ROOM_LABELS[room as Room] || room;

    // Find or create Stripe customer
    const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        phone: customerPhone || undefined,
      });
      customerId = customer.id;
    }

    // Create Stripe Checkout Session
    // NOTE: We use automatic payment methods (Stripe Dashboard controls which are shown).
    // setup_future_usage is set ONLY for card via payment_method_options, because
    // Cash App Pay, Venmo, etc. do NOT support saving for future off-session charges.
    // Previously this was set at the payment_intent_data level which caused Cash App Pay
    // payments to silently fail (checkout never completed, webhook never fired).
    // Stripe Checkout line item — copy distinguishes band vs solo so the
    // customer's receipt and Stripe dashboard read naturally. The webhook
    // doesn't read `product_data.name`; it's pure UX.
    const lineItemName = isBandBooking && band
      ? `Band Session Deposit — ${band.display_name}${sweetSpotAddon ? ' + Sweet Spot' : ''}`
      : `Recording Session Deposit — ${roomLabel}`;
    // Description tells the customer what they're paying for in plain
    // language. 24hr (3-day) reads as "3-day block starting Day 1 ${date}";
    // Sweet Spot add-on adds " + Sweet Spot filming" so the receipt is
    // explicit about the extra deliverable.
    const lineItemDescription = isBandBooking
      ? `${
          Number(duration) === 24
            ? `3-day band block (8hr/day) starting ${date}`
            : `${formatDuration(duration)} band session on ${date} at ${startTime}`
        }${sweetSpotAddon ? ' + Sweet Spot filming' : ''} (50% deposit)`
      : `${formatDuration(duration)} session on ${date} at ${startTime} (50% deposit)`;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: PRICING.currency,
            product_data: {
              name: lineItemName,
              description: lineItemDescription,
            },
            unit_amount: pricing.deposit,
          },
          quantity: 1,
        },
      ],
      payment_method_options: {
        card: {
          setup_future_usage: 'off_session',
        },
      },
      success_url: `${SITE_URL}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/book`,
      metadata: {
        // `type` is the discriminator the webhook branches on. Keeping the
        // original `booking_deposit` value for solo sessions means zero
        // change to existing webhook logic; band bookings get their own
        // tag so the webhook can persist `band_id` + skip solo-only fields.
        type: isBandBooking ? 'band_booking_deposit' : 'booking_deposit',
        band_id: isBandBooking && band ? band.id : '',
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone || '',
        session_date: date,
        start_time: startTime,
        end_time: endTime,
        duration_hours: String(duration),
        room,
        engineer: requestedEngineer,
        notes: notes || '',
        total_amount: String(pricing.total),
        deposit_amount: String(pricing.deposit),
        remainder_amount: String(pricing.total - pricing.deposit),
        night_fees: String(pricing.nightFees),
        same_day: String(sameDayBooking),
        same_day_fee: String(pricing.sameDayFee),
        guest_count: String(guestCount),
        guest_fee: String(pricing.guestFee),
        // Free setup hour reservation. Band 4hr/8hr sessions all pad 60min
        // before. Band 24hr (3-day): the webhook applies setup to the day-1
        // row only, but the deposit-time metadata still records 60 to flag
        // the intent. Solo sessions get 0.
        setup_minutes_before: isBandBooking ? '60' : '0',
        // Sweet Spot filming add-on metadata. JSON-stringified for Stripe's
        // 500-char-per-field limit (the object is small — kind + optional
        // day index). Webhook re-parses and writes to bookings.sweet_spot_addon.
        sweet_spot_addon: sweetSpotAddon ? JSON.stringify(sweetSpotAddon) : '',
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Booking creation error:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
