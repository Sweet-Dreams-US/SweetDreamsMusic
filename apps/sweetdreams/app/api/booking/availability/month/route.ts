import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Returns availability summary for each day in a given month.
 * Query params: year (number), month (0-indexed number)
 * Response: { days: Record<string, { booked: number; total: number }> }
 *   - booked: number of half-hour slots that are booked/blocked
 *   - total: 48 (half-hour slots per day)
 */

const TOTAL_SLOTS_PER_DAY = 48; // 24 hours * 2 half-hour slots

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const yearStr = searchParams.get('year');
  const monthStr = searchParams.get('month');

  if (!yearStr || !monthStr) {
    return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
  }

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 0-indexed

  if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
    return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Build date range for the entire month
  const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDayNum = new Date(year, month + 1, 0).getDate();
  const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

  const monthStart = `${firstDay}T00:00:00`;
  const monthEnd = `${lastDay}T23:59:59`;

  // Fetch all bookings in this month
  const { data: bookings, error: bookErr } = await supabase
    .from('bookings')
    .select('start_time, duration')
    .gte('start_time', monthStart)
    .lte('start_time', monthEnd)
    .in('status', ['confirmed', 'pending']);

  if (bookErr) {
    console.error('Month availability error (bookings):', bookErr);
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 });
  }

  // Fetch STUDIO-WIDE block-off times in this month. `engineer_name IS
  // NULL` excludes engineer-scoped blocks (created from the engineer
  // availability tab) — those don't close the studio, they only make
  // that one engineer unbookable, enforced in /api/booking/create.
  // Without this filter an engineer self-block greyed out the whole
  // month calendar for every customer.
  const { data: blocks, error: blockErr } = await supabase
    .from('studio_blocks')
    .select('start_time, end_time')
    .is('engineer_name', null)
    .gte('start_time', monthStart)
    .lte('start_time', monthEnd);

  if (blockErr) {
    console.error('Month availability error (blocks):', blockErr);
    // Non-fatal, continue without blocks
  }

  // Accumulate booked slots per day
  const dayCounts: Record<string, Set<number>> = {};

  function ensureDay(dateStr: string) {
    if (!dayCounts[dateStr]) {
      dayCounts[dateStr] = new Set();
    }
  }

  // Process bookings
  for (const booking of bookings || []) {
    const st = new Date(booking.start_time);
    const dateStr = booking.start_time.split('T')[0];
    ensureDay(dateStr);

    const startSlot = st.getUTCHours() + st.getUTCMinutes() / 60;
    const hours = booking.duration || 1;
    const halfHourCount = hours * 2;

    for (let i = 0; i < halfHourCount; i++) {
      const slot = (startSlot + i * 0.5) % 24;
      dayCounts[dateStr].add(slot);
    }
  }

  // Process admin blocks
  for (const block of (blocks || [])) {
    const bStart = new Date(block.start_time);
    const bEnd = new Date(block.end_time);
    const dateStr = block.start_time.split('T')[0];
    ensureDay(dateStr);

    const startSlot = bStart.getUTCHours() + bStart.getUTCMinutes() / 60;
    const endSlot = bEnd.getUTCHours() + bEnd.getUTCMinutes() / 60;
    const totalSlots = Math.ceil((endSlot - startSlot) * 2);

    for (let i = 0; i < totalSlots; i++) {
      const slot = (startSlot + i * 0.5) % 24;
      dayCounts[dateStr].add(slot);
    }
  }

  // Build response: { days: { "2026-04-05": { booked: 12, total: 48 }, ... } }
  const days: Record<string, { booked: number; total: number }> = {};

  for (let d = 1; d <= lastDayNum; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const bookedCount = dayCounts[dateStr]?.size || 0;
    days[dateStr] = { booked: bookedCount, total: TOTAL_SLOTS_PER_DAY };
  }

  return NextResponse.json({ days });
}
