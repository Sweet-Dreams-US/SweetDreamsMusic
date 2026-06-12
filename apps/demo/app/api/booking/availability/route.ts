import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const SAME_DAY_BUFFER_HOURS = 3; // 3-hour buffer from current time for same-day bookings

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');

  if (!date) {
    return NextResponse.json({ error: 'Date is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Query ALL bookings on this date (studios share space, can't overlap)
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;

  // Pull setup_minutes_before so we can extend the blocked window for band
  // sessions that have a free setup hour reserved (migration 041). For
  // existing rows / non-band rows the column defaults to 0 and the math
  // collapses to the old behavior.
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('start_time, duration, setup_minutes_before')
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .in('status', ['confirmed', 'pending']);

  if (error) {
    console.error('Availability check error:', error);
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 });
  }

  // Query STUDIO-WIDE block-off times for this date.
  //
  // `engineer_name IS NULL` is the critical filter: a studio_blocks row
  // with engineer_name set is an ENGINEER-SCOPED block (created from the
  // engineer availability tab — e.g. "Jay is shooting off-site"). Those
  // do NOT close the studio — other engineers + both rooms stay
  // bookable. Engineer-scoped blocks are enforced separately in
  // /api/booking/create via isEngineerBlocked() when a customer requests
  // that specific engineer. Only `engineer_name IS NULL` rows
  // (admin maintenance, private events) close the room calendar.
  const { data: blocks } = await supabase
    .from('studio_blocks')
    .select('start_time, end_time')
    .is('engineer_name', null)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd);

  // Convert bookings to blocked half-hour slots (decimal: 18.5 = 6:30 PM).
  //
  // Phase 4 (band setup hour): each row may carry setup_minutes_before. We
  // pad the start of the blocked window backward by that many minutes so a
  // 4hr band session at 2pm correctly blocks 1pm-6pm (5hr total) instead
  // of just 2pm-6pm. Default is 0 → no behavior change for legacy rows.
  const bookedSlots: number[] = [];
  for (const booking of bookings || []) {
    const st = new Date(booking.start_time);
    const setupHours = (booking.setup_minutes_before || 0) / 60;
    // Move the block start earlier by the setup window. Modulo 24 to wrap
    // when a midnight session has a setup hour spilling to the prior day —
    // unusual but won't break the math.
    const startSlot = (
      st.getUTCHours() + st.getUTCMinutes() / 60 - setupHours + 24
    ) % 24;
    const hours = booking.duration || 1;
    const totalHours = hours + setupHours;
    const halfHourCount = Math.ceil(totalHours * 2);
    for (let i = 0; i < halfHourCount; i++) {
      const slot = (startSlot + i * 0.5) % 24;
      if (!bookedSlots.includes(slot)) {
        bookedSlots.push(slot);
      }
    }
  }

  // Add admin block-off slots
  for (const block of blocks || []) {
    const bStart = new Date(block.start_time);
    const bEnd = new Date(block.end_time);
    const startSlot = bStart.getUTCHours() + bStart.getUTCMinutes() / 60;
    const endSlot = bEnd.getUTCHours() + bEnd.getUTCMinutes() / 60;
    const totalSlots = Math.ceil((endSlot - startSlot) * 2);
    for (let i = 0; i < totalSlots; i++) {
      const slot = (startSlot + i * 0.5) % 24;
      if (!bookedSlots.includes(slot)) {
        bookedSlots.push(slot);
      }
    }
  }

  // Same-day buffer: block slots within 3 hours from now (Fort Wayne time)
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Indiana/Indianapolis' });
  if (date === todayLocal) {
    const nowFW = new Date().toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' });
    const nowDate = new Date(nowFW);
    const currentDecimal = nowDate.getHours() + nowDate.getMinutes() / 60;
    const bufferCutoff = currentDecimal + SAME_DAY_BUFFER_HOURS;
    // Round up to next 30-min slot
    const cutoffSlot = Math.ceil(bufferCutoff * 2) / 2;

    for (let slot = 0; slot < cutoffSlot; slot += 0.5) {
      if (!bookedSlots.includes(slot)) {
        bookedSlots.push(slot);
      }
    }
  }

  return NextResponse.json({ bookedSlots });
}
