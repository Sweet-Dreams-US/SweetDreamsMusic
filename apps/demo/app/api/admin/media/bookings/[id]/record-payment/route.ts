// app/api/admin/media/bookings/[id]/record-payment/route.ts
//
// Admin records a manual (non-Stripe) payment against a media booking.
// Mirrors /api/booking/record-payment for studio sessions.
//
// Body: {
//   amount: number_in_cents,
//   method: 'cash' | 'venmo' | 'check' | 'other',
//   note?: string,
//   addToTotal?: boolean,        // if true: bumps final_price by amount
//                                // (admin added scope mid-project), the
//                                // remainder stays the same since the
//                                // recorded payment covers the increase
//   collected_by?: string        // who took the cash (employee/admin name)
// }
//
// Side effects:
//   • Update media_bookings.actual_deposit_paid (or total)
//   • If method='cash': insert cash_ledger row (status='owed' until
//     deposited to the business account by an admin)
//   • Insert media_booking_audit_log row
//   • Mark final_paid_at when remainder hits 0

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const VALID_METHODS = ['cash', 'venmo', 'check', 'other'] as const;
type PaymentMethod = (typeof VALID_METHODS)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const amount = typeof body.amount === 'number' ? body.amount : 0;
  const method = (typeof body.method === 'string' ? body.method : '') as PaymentMethod;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const addToTotal = body.addToTotal === true;
  const collectedBy =
    typeof body.collected_by === 'string' && body.collected_by.trim().length > 0
      ? body.collected_by.trim()
      : user.email;

  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'amount must be a positive integer (cents)' },
      { status: 400 },
    );
  }
  if (!VALID_METHODS.includes(method)) {
    return NextResponse.json(
      { error: `method must be one of: ${VALID_METHODS.join(', ')}` },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: bookingRow, error: readErr } = await service
    .from('media_bookings')
    .select('id, user_id, band_id, final_price_cents, deposit_cents, actual_deposit_paid, final_paid_at, is_test, status')
    .eq('id', id)
    .maybeSingle();
  if (readErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  type Row = {
    id: string;
    user_id: string;
    band_id: string | null;
    final_price_cents: number;
    deposit_cents: number | null;
    actual_deposit_paid: number | null;
    final_paid_at: string | null;
    is_test: boolean | null;
    status: string;
  };
  const booking = bookingRow as Row;
  if (booking.is_test) {
    return NextResponse.json(
      { error: 'Test bookings cannot record real payments.' },
      { status: 400 },
    );
  }

  const previousPaid = booking.actual_deposit_paid ?? booking.deposit_cents ?? 0;
  const previousTotal = booking.final_price_cents;

  let newTotal = previousTotal;
  let newPaid = previousPaid;

  if (addToTotal) {
    // Bumping scope: total goes up by `amount`, the recorded payment
    // covers the increase. Remainder net change is 0.
    newTotal = previousTotal + amount;
    newPaid = previousPaid + amount;
  } else {
    // Regular payment against the existing balance.
    newPaid = Math.min(previousTotal, previousPaid + amount);
  }
  const newRemainder = Math.max(0, newTotal - newPaid);

  const updates: Record<string, unknown> = {
    actual_deposit_paid: newPaid,
  };
  if (newTotal !== previousTotal) updates.final_price_cents = newTotal;
  if (newRemainder === 0 && !booking.final_paid_at) {
    updates.final_paid_at = new Date().toISOString();
  }

  const { error: updErr } = await service
    .from('media_bookings')
    .update(updates)
    .eq('id', id);
  if (updErr) {
    return NextResponse.json(
      { error: `Could not record payment: ${updErr.message}` },
      { status: 500 },
    );
  }

  // ── Audit ──────────────────────────────────────────────────────────
  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: `${method}_payment`,
    performed_by: user.email,
    details: {
      amount_cents: amount,
      method,
      note,
      collected_by: collectedBy,
      addToTotal,
      previous_total: previousTotal,
      new_total: newTotal,
      previous_paid: previousPaid,
      new_paid: newPaid,
      new_remainder: newRemainder,
    },
  });

  // ── Cash ledger insert when method=cash ────────────────────────────
  // Reuses the existing studio cash_ledger table — we extended it with
  // `media_booking_id` in migration 045 so media + studio cash share the
  // same audit trail. `engineer_name` field repurposed to record who
  // physically took the cash (could be Cole, Jay, an engineer, etc).
  if (method === 'cash') {
    try {
      // Pull buyer name for the ledger row.
      const { data: buyer } = await service
        .from('profiles')
        .select('display_name')
        .eq('user_id', booking.user_id)
        .maybeSingle();
      const buyerName = (buyer as { display_name: string } | null)?.display_name ?? 'Unknown';

      await service.from('cash_ledger').insert({
        media_booking_id: id,
        booking_id: null, // explicit XOR — this is a media collection
        engineer_name: collectedBy,
        amount,
        client_name: buyerName,
        note: note || `Media remainder cash payment`,
        recorded_by: user.email,
        status: 'owed',
      });
    } catch (e) {
      // Don't fail the payment recording over a ledger error — the
      // audit log already has the trail. Log loudly so we can chase.
      console.error('[record-payment/media] cash_ledger insert failed:', e);
    }
  }

  return NextResponse.json({
    success: true,
    method,
    amountRecorded: amount,
    newPaid,
    newTotal,
    newRemainder,
  });
}
