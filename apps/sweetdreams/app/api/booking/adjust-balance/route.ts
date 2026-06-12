import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { checkBookingOwnership } from '@/lib/booking-ownership';
import { depositCollectedCents } from '@/lib/deposit';

/**
 * POST /api/booking/adjust-balance
 *
 * Engineer-or-admin version of the admin-only balance-edit endpoint.
 *
 * Unlike `/api/admin/bookings/adjust-balance`, this path accepts calls
 * from engineers for sessions they're assigned to. The ownership check is
 * enforced server-side — engineers can't adjust peers' balances.
 *
 * Body: { bookingId: string, newRemainderCents: number }
 *
 * Same guards as the admin endpoint:
 *   - newRemainderCents must be a non-negative integer.
 *   - newRemainderCents cannot exceed (total_amount - actual_deposit_paid).
 *
 * All adjustments are logged to booking_audit_log with the performer's
 * email and the delta, so the paper trail matches the admin endpoint.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { bookingId?: unknown; newRemainderCents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { bookingId, newRemainderCents } = body;

  if (typeof bookingId !== 'string' || !bookingId.trim()) {
    return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
  }

  if (
    typeof newRemainderCents !== 'number' ||
    !Number.isInteger(newRemainderCents) ||
    newRemainderCents < 0
  ) {
    return NextResponse.json(
      { error: 'newRemainderCents must be a non-negative integer (in cents)' },
      { status: 400 }
    );
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('bookings')
    .select('id, engineer_name, total_amount, deposit_amount, actual_deposit_paid, remainder_amount, stripe_payment_intent_id, status, customer_email, customer_name')
    .eq('id', bookingId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Ownership check — admins bypass.
  const ownership = await checkBookingOwnership(supabase, existing.engineer_name);
  if (!ownership.isAdmin && !ownership.ownsBooking) {
    return NextResponse.json(
      { error: 'You can only adjust balances on sessions assigned to you.' },
      { status: 403 }
    );
  }

  const totalAmount = existing.total_amount || 0;
  const depositPaid = depositCollectedCents(existing);
  const maxAllowedRemainder = Math.max(0, totalAmount - depositPaid);

  if (newRemainderCents > maxAllowedRemainder) {
    return NextResponse.json(
      {
        error: `New balance cannot exceed $${(maxAllowedRemainder / 100).toFixed(2)} (total minus already-paid deposit).`,
        maxAllowedCents: maxAllowedRemainder,
      },
      { status: 400 }
    );
  }

  const previousRemainder = existing.remainder_amount ?? 0;

  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({ remainder_amount: newRemainderCents, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .select('id, remainder_amount, customer_email, customer_name, status, total_amount, deposit_amount, actual_deposit_paid')
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Audit — do not swallow errors (matching the record-payment paper trail).
  try {
    const { error: auditErr } = await supabase.from('booking_audit_log').insert({
      booking_id: bookingId,
      action: 'remainder_adjusted',
      performed_by: user.email || 'unknown',
      details: {
        previous_remainder: previousRemainder,
        new_remainder: newRemainderCents,
        delta: newRemainderCents - previousRemainder,
        asAdmin: ownership.isAdmin,
        matchedNames: ownership.matchedNames,
      },
    });
    if (auditErr) {
      console.error('[ADJUST-BALANCE] Audit log insert failed:', {
        bookingId, previousRemainder, newRemainderCents, err: auditErr.message,
      });
    }
  } catch (e) {
    console.error('[ADJUST-BALANCE] Audit log threw:', {
      bookingId, err: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ booking: updated, previousRemainder });
}
