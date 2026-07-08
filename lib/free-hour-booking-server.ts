// lib/free-hour-booking-server.ts
//
// Instant-confirm a fully-credit-covered studio booking (nothing due now, so no
// Stripe). This is the no-charge path a free-hour redemption falls into when the
// discount covers the whole cost — e.g. a 1-HOUR session redeemed with a free
// hour and no surcharges (base fully waived → $0). Mirrors the proven PATH B of
// app/api/media/credits/book: conflict-check → insert booking → link + drain the
// credit (optimistic concurrency) → notify. Rolls back on a later-step failure.
//
// Used by app/api/booking/create when a /book free-hour booking nets to $0 (a
// $0 Stripe checkout is impossible, and the booking is otherwise only created by
// the payment webhook — so without this path a free booking would never exist).
//
// The credit drains exactly `hoursToDecrement` (always 1 for the /book toggle),
// independent of the dollar discount. service_value_cents preserves the FULL
// session value so engineer payroll is unaffected.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINEERS, type Room } from '@/lib/constants';
import { paidBookingStatus } from '@/lib/booking-status';
import { sendEngineerNewBookingAlert, sendBookingConfirmation, sendAdminBookingAlert } from '@/lib/email';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export interface InstantFreeHourBookingParams {
  userId: string;
  customerName: string;
  customerEmail: string;
  room: Room;
  /** Concrete engineer name → born 'confirmed'. null/'any' → 'pending' (awaiting claim). */
  engineerName: string | null;
  date: string;            // YYYY-MM-DD (studio-local)
  startTime: string;       // HH:MM (padded, studio-local)
  startISO: string;        // `${date}T${HH:MM}:00`
  endISO: string;          // start + duration
  durationHours: number;
  serviceValueCents: number; // FULL session value (engineer payout basis)
  guestCount: number;
  creditId: string;
  creditHoursUsed: number;   // current hours_used, for the optimistic-concurrency guard
  hoursToDecrement: number;  // hours consumed from the credit (1 for the /book toggle)
  adminNotes: string;
  bandId: string | null;
  rewardGrantId: string | null;
}

export type InstantFreeHourResult =
  | { ok: true; bookingId: string }
  | { ok: false; status: number; error: string };

export async function instantConfirmFreeHourBooking(
  service: Client,
  p: InstantFreeHourBookingParams,
): Promise<InstantFreeHourResult> {
  const engineerName = p.engineerName && p.engineerName !== 'any' ? p.engineerName : null;
  const engineerEntry = engineerName ? ENGINEERS.find((e) => e.name === engineerName) : undefined;

  // ── Conflict check (half-open overlap: A.start < B.end && B.start < A.end) ──
  const dayStart = `${p.date}T00:00:00`;
  const dayEnd = `${p.date}T23:59:59`;
  const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
    new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

  const { data: roomBookings } = await service
    .from('bookings')
    .select('id, start_time, end_time, duration, status')
    .eq('room', p.room)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .not('status', 'in', '(cancelled)');
  for (const b of (roomBookings || []) as Array<{ start_time: string; end_time: string | null; duration: number }>) {
    const bEnd = b.end_time || new Date(new Date(b.start_time).getTime() + b.duration * 3600000).toISOString();
    if (overlaps(p.startISO, p.endISO, b.start_time, bEnd)) {
      return { ok: false, status: 409, error: `${p.room.replace('_', ' ')} is booked during that time — pick another slot.` };
    }
  }
  if (engineerName) {
    const { data: engBookings } = await service
      .from('bookings')
      .select('id, start_time, end_time, duration, status')
      .eq('engineer_name', engineerName)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .not('status', 'in', '(cancelled)');
    for (const b of (engBookings || []) as Array<{ start_time: string; end_time: string | null; duration: number }>) {
      const bEnd = b.end_time || new Date(new Date(b.start_time).getTime() + b.duration * 3600000).toISOString();
      if (overlaps(p.startISO, p.endISO, b.start_time, bEnd)) {
        return { ok: false, status: 409, error: `${engineerEntry?.displayName || engineerName} is in another session at that time.` };
      }
    }
  }

  // ── Insert booking (born 'confirmed' iff an engineer is attached) ──
  const { data: newBooking, error: bookErr } = await service
    .from('bookings')
    .insert({
      customer_name: p.customerName,
      customer_email: p.customerEmail,
      start_time: p.startISO,
      end_time: p.endISO,
      duration: p.durationHours,
      room: p.room,
      engineer_name: engineerName,
      requested_engineer: engineerName,
      total_amount: 0,               // fully credit-covered
      service_value_cents: p.serviceValueCents,
      deposit_amount: 0,
      remainder_amount: 0,
      actual_deposit_paid: 0,
      guest_count: p.guestCount,
      guest_fee_amount: 0,           // $0 path ⇒ no surcharges (incl. guest fee)
      status: paidBookingStatus(engineerName),
      admin_notes: p.adminNotes,
      band_id: p.bandId,
      reward_grant_id: p.rewardGrantId,
    } as never)
    .select('id')
    .single();
  if (bookErr || !newBooking) {
    console.error('[free-hour-booking] insert error:', bookErr);
    return { ok: false, status: 500, error: 'Could not create booking' };
  }
  const bookingId = (newBooking as { id: string }).id;

  // ── Link + drain the credit (optimistic concurrency; roll back on failure) ──
  const { error: redemptionErr } = await service
    .from('studio_credit_redemptions')
    .insert({
      credit_id: p.creditId,
      studio_booking_id: bookingId,
      hours_redeemed: p.hoursToDecrement,
      redeemed_by: p.userId,
    } as never);
  if (redemptionErr) {
    console.error('[free-hour-booking] redemption insert error:', redemptionErr);
    await service.from('bookings').delete().eq('id', bookingId);
    return { ok: false, status: 500, error: 'Could not record the free-hour redemption' };
  }
  const { error: drainErr } = await service
    .from('studio_credits')
    .update({ hours_used: p.creditHoursUsed + p.hoursToDecrement } as never)
    .eq('id', p.creditId)
    .eq('hours_used', p.creditHoursUsed); // optimistic concurrency; CHECK blocks overdraw
  if (drainErr) {
    console.error('[free-hour-booking] credit drain error:', drainErr);
    await service.from('studio_credit_redemptions').delete().eq('studio_booking_id', bookingId);
    await service.from('bookings').delete().eq('id', bookingId);
    return { ok: false, status: 409, error: 'Your free-hour balance changed — try again.' };
  }

  // ── Notifications (fire-and-forget; never block the booking) ──
  const dateStr = new Date(p.startISO).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = new Date(p.startISO).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (engineerEntry) {
    try {
      await sendEngineerNewBookingAlert([engineerEntry.email], {
        id: bookingId, customerName: p.customerName, date: dateStr, startTime: timeStr,
        duration: p.durationHours, room: p.room,
      });
    } catch (e) { console.error('[free-hour-booking] engineer alert error:', e); }
  }
  try {
    await sendBookingConfirmation(p.customerEmail, {
      customerName: p.customerName, date: dateStr, startTime: timeStr, duration: p.durationHours,
      room: p.room, total: 0, deposit: 0, bookingId,
    });
  } catch (e) { console.error('[free-hour-booking] customer confirmation error:', e); }
  try {
    await sendAdminBookingAlert({
      id: bookingId, customerName: p.customerName, customerEmail: p.customerEmail, date: dateStr,
      startTime: timeStr, duration: p.durationHours, room: p.room, total: 0,
    });
  } catch (e) { console.error('[free-hour-booking] admin alert error:', e); }

  return { ok: true, bookingId };
}
