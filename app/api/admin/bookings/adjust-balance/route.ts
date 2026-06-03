import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { depositCollectedCents } from '@/lib/deposit';

/**
 * POST /api/admin/bookings/adjust-balance
 *
 * Admin-only endpoint to manually set a booking's remaining balance
 * (remainder_amount). Used when a client has paid off-platform or when
 * a stale balance needs to be zeroed out.
 *
 * Body: { bookingId: string, newRemainderCents: number }
 *
 * Guards:
 *   - Must be a super-admin (finance action, not engineer-level).
 *   - newRemainderCents must be a non-negative integer.
 *   - newRemainderCents cannot exceed (total_amount - actual_deposit_paid)
 *     — we never invent balance beyond what would be legitimately owed
 *     if no further payment was made.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 401 }
    );
  }

  let body: { bookingId?: unknown; newRemainderCents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { bookingId, newRemainderCents } = body;

  if (typeof bookingId !== 'string' || !bookingId.trim()) {
    return NextResponse.json(
      { error: 'bookingId is required' },
      { status: 400 }
    );
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

  // Fetch the booking so we can validate the ceiling.
  const { data: existing, error: fetchErr } = await supabase
    .from('bookings')
    .select('id, total_amount, deposit_amount, actual_deposit_paid, remainder_amount, stripe_payment_intent_id, status, customer_email, customer_name')
    .eq('id', bookingId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
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

  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({ remainder_amount: newRemainderCents })
    .eq('id', bookingId)
    .select('id, remainder_amount, customer_email, customer_name, status, total_amount, deposit_amount, actual_deposit_paid')
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ booking: updated, previousRemainder: existing.remainder_amount });
}
