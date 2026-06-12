import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { checkBookingOwnership } from '@/lib/booking-ownership';
import { paidBookingStatus } from '@/lib/booking-status';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { bookingId, amount, method, note, addToTotal } = await request.json();
  if (!bookingId || !amount || !method) {
    return NextResponse.json({ error: 'bookingId, amount, and method required' }, { status: 400 });
  }

  // Get the booking
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, remainder_amount, total_amount, deposit_amount, engineer_name, customer_name, start_time, duration')
    .eq('id', bookingId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Ownership gate — engineers may only record payments on their own sessions.
  // Admins bypass this. Without this check, any engineer could record cash on
  // peers' sessions, which is how audits get unpleasant.
  const ownership = await checkBookingOwnership(supabase, booking.engineer_name);
  if (!ownership.isAdmin && !ownership.ownsBooking) {
    return NextResponse.json(
      { error: 'You can only record payments on sessions assigned to you.' },
      { status: 403 }
    );
  }

  const amountCents = Math.round(amount * 100);

  // ── Cash deposit on a pending invite → confirm + hold the slot ──
  // Distinct from a remainder paydown on an already-confirmed booking
  // (handled by the unchanged logic below). Per spec §7: recording cash A
  // sets actual_deposit_paid = min(A, deposit), remainder = max(0, total - A),
  // and flips status to 'confirmed'. Guarded by a slot-conflict check that
  // BLOCKS (never double-books) if the open slot was taken in the meantime.
  // Uses the SERVICE client throughout: the conflict check must see EVERY
  // engineer's bookings — the RLS-scoped client could hide peers' bookings and
  // let a double-book slip through (the create flow uses the service client for
  // the same reason).
  if (booking.status === 'pending_deposit') {
    // "Extend Session" (addToTotal) is a confirmed-booking operation and the
    // confirm math below ignores it — reject it here so it can't be silently
    // mis-recorded on an unconfirmed cash invite.
    if (addToTotal) {
      return NextResponse.json(
        { error: 'Confirm the deposit first, then extend the session.' },
        { status: 400 },
      );
    }

    const serviceClient = createServiceClient();

    // Slot conflict guard — replicates app/api/booking/create/route.ts
    // (time-overlap across confirmed+pending on the same date; room-agnostic,
    // since the studio shares space). The pending_deposit row itself is not in
    // that status set, so it can't conflict with itself; .neq is belt-and-suspenders.
    const bDate = booking.start_time.split('T')[0];
    const bt = new Date(booking.start_time);
    const startHour = bt.getUTCHours() + bt.getUTCMinutes() / 60;
    const dur = Number(booking.duration) || 1;
    const requestedSlots = Array.from({ length: Math.ceil(dur * 2) }, (_, i) => (startHour + i * 0.5) % 24);

    const { data: clashes } = await serviceClient
      .from('bookings')
      .select('id, start_time, duration')
      .gte('start_time', `${bDate}T00:00:00`)
      .lte('start_time', `${bDate}T23:59:59`)
      .in('status', ['confirmed', 'pending'])
      .neq('id', bookingId);

    for (const other of clashes || []) {
      const ot = new Date(other.start_time);
      const oStart = ot.getUTCHours() + ot.getUTCMinutes() / 60;
      const oSlots = Array.from({ length: Math.ceil((Number(other.duration) || 1) * 2) }, (_, i) => (oStart + i * 0.5) % 24);
      if (requestedSlots.some((s) => oSlots.includes(s))) {
        return NextResponse.json(
          { error: 'This time was booked by someone else — reschedule this cash booking to an open time first.' },
          { status: 409 },
        );
      }
    }

    const depositTarget = booking.deposit_amount || 0;
    const actualDepositPaid = Math.min(amountCents, depositTarget);
    const confirmedRemainder = Math.max(0, booking.total_amount - amountCents);

    const { error: confErr } = await serviceClient.from('bookings').update({
      // Cash deposit recorded: confirmed only if the invite already names an
      // engineer; otherwise 'pending' (Awaiting Engineer) until one claims.
      status: paidBookingStatus(booking.engineer_name),
      actual_deposit_paid: actualDepositPaid,
      remainder_amount: confirmedRemainder,
      updated_at: new Date().toISOString(),
    }).eq('id', bookingId);

    if (confErr) {
      console.error('[RECORD-PAYMENT] confirm-deposit update failed:', confErr);
      return NextResponse.json({ error: confErr.message }, { status: 500 });
    }

    // Audit + cash ledger (cash only) — mirrors the standard path below.
    try {
      await serviceClient.from('booking_audit_log').insert({
        booking_id: bookingId,
        action: 'cash_deposit_confirm',
        performed_by: user.email || 'unknown',
        details: {
          amount: amountCents, method, note: note || '',
          deposit_target: depositTarget,
          actual_deposit_paid: actualDepositPaid,
          new_remainder: confirmedRemainder,
          confirmed_from: 'pending_deposit',
        },
      });
    } catch (e) {
      console.error('[RECORD-PAYMENT] confirm-deposit audit threw:', e instanceof Error ? e.message : String(e));
    }

    if (method === 'cash' && booking.engineer_name) {
      try {
        await serviceClient.from('cash_ledger').insert({
          booking_id: bookingId,
          engineer_name: booking.engineer_name,
          amount: amountCents,
          client_name: booking.customer_name || 'Unknown',
          note: note || 'Cash deposit recorded (booking confirmed)',
          recorded_by: user.email || 'unknown',
          status: 'owed',
        });
      } catch (e) {
        console.error('Cash ledger error (confirm-deposit):', e);
      }
    }

    return NextResponse.json({
      success: true,
      amountRecorded: amountCents,
      newRemainder: confirmedRemainder,
      confirmed: true,
    });
  }

  // If this is "Add Time" — increase total AND record the cash as paying for that added time
  // The net effect on remainder is: remainder stays the same (total goes up, cash covers it)
  // If this is a regular payment — just subtract from remainder
  let newTotal = booking.total_amount;
  let newRemainder = booking.remainder_amount;

  if (addToTotal) {
    // Added time/services: total increases, cash covers the increase
    newTotal = booking.total_amount + amountCents;
    // Remainder stays the same — the new charge is fully covered by the cash
    newRemainder = booking.remainder_amount;
  } else {
    // Regular payment against existing remainder
    newRemainder = Math.max(0, booking.remainder_amount - amountCents);
  }

  await supabase.from('bookings').update({
    total_amount: newTotal,
    remainder_amount: newRemainder,
    updated_at: new Date().toISOString(),
  }).eq('id', bookingId);

  // Log the payment in audit log — do not break payment recording on audit failure,
  // but DO log loudly to stderr so we can reconstruct what happened if needed.
  // (Previously this try/catch silently swallowed errors, which made the 2026-04-20
  // Bloodika duplicate-cash incident much harder to trace.)
  try {
    const { error: auditErr } = await supabase.from('booking_audit_log').insert({
      booking_id: bookingId,
      action: `${method}_payment`,
      performed_by: user.email || 'unknown',
      details: {
        amount: amountCents,
        method,
        note: note || '',
        addToTotal: !!addToTotal,
        previous_total: booking.total_amount,
        new_total: newTotal,
        previous_remainder: booking.remainder_amount,
        new_remainder: newRemainder,
      },
    });
    if (auditErr) {
      console.error('[RECORD-PAYMENT] Audit log insert failed:', {
        bookingId,
        amount: amountCents,
        method,
        addToTotal: !!addToTotal,
        error: auditErr.message,
      });
    }
  } catch (e) {
    console.error('[RECORD-PAYMENT] Audit log threw:', {
      bookingId, amount: amountCents, method, err: e instanceof Error ? e.message : String(e),
    });
  }

  // If cash payment, log to cash ledger — engineer owes business this amount
  if (method === 'cash' && booking.engineer_name) {
    try {
      const { createServiceClient } = await import('@/lib/supabase/server');
      const serviceClient = createServiceClient();
      await serviceClient.from('cash_ledger').insert({
        booking_id: bookingId,
        engineer_name: booking.engineer_name,
        amount: amountCents,
        client_name: booking.customer_name || 'Unknown',
        note: note || 'Cash payment recorded',
        recorded_by: user.email || 'unknown',
        status: 'owed',
      });
    } catch (e) {
      console.error('Cash ledger error:', e);
    }
  }

  return NextResponse.json({
    success: true,
    amountRecorded: amountCents,
    newRemainder,
  });
}
