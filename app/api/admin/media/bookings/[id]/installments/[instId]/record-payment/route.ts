// app/api/admin/media/bookings/[id]/installments/[instId]/record-payment/route.ts
//
// Media Projects — record a MANUAL (non-Stripe) payment against one
// installment. Mirrors the booking-level record-payment, scoped to a stint.
//
// Body: { method: 'cash' | 'venmo' | 'check' | 'other', note?: string,
//         collected_by?: string }
//   → status='paid', paid_at=now(), paid_method=method.
//   Audit: `installment_paid_manual`.
//   When method='cash', also drops a cash_ledger row (same pattern as the
//   booking-level record-payment) so media + studio cash share one trail.
//
// Idempotent-ish: a stint already 'paid' returns 409 (don't double-record).
// Admin-gated.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const VALID_METHODS = ['cash', 'venmo', 'check', 'other'] as const;
type ManualMethod = (typeof VALID_METHODS)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; instId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id, instId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const method = (typeof body.method === 'string' ? body.method : '') as ManualMethod;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const collectedBy =
    typeof body.collected_by === 'string' && body.collected_by.trim()
      ? body.collected_by.trim()
      : user.email;

  if (!VALID_METHODS.includes(method)) {
    return NextResponse.json(
      { error: `method must be one of: ${VALID_METHODS.join(', ')}` },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  // ── Load booking (test guard + buyer name for the ledger) ──────────
  const { data: bookingRow, error: bErr } = await service
    .from('media_bookings')
    .select('id, user_id, is_test')
    .eq('id', id)
    .maybeSingle();
  if (bErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  const booking = bookingRow as { id: string; user_id: string; is_test: boolean | null };
  if (booking.is_test) {
    return NextResponse.json(
      { error: 'Test bookings cannot record real payments.' },
      { status: 400 },
    );
  }

  // ── Load the installment ───────────────────────────────────────────
  const { data: instRow, error: iErr } = await service
    .from('media_payment_installments')
    .select('id, booking_id, label, amount_cents, status')
    .eq('id', instId)
    .eq('booking_id', id)
    .maybeSingle();
  if (iErr || !instRow) {
    return NextResponse.json({ error: 'Installment not found' }, { status: 404 });
  }
  const installment = instRow as {
    id: string;
    label: string;
    amount_cents: number;
    status: string;
  };

  if (installment.status === 'paid') {
    return NextResponse.json(
      { error: 'This installment is already paid.' },
      { status: 409 },
    );
  }
  if (installment.status === 'void') {
    return NextResponse.json(
      { error: 'This installment is void.' },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();

  // ── Mark paid ──────────────────────────────────────────────────────
  const { error: updErr } = await service
    .from('media_payment_installments')
    .update({
      status: 'paid',
      paid_at: nowIso,
      paid_method: method,
    })
    .eq('id', instId)
    .eq('booking_id', id);
  if (updErr) {
    console.error('[installments/record-payment] update error:', updErr);
    return NextResponse.json(
      { error: `Could not record payment: ${updErr.message}` },
      { status: 500 },
    );
  }

  // ── Audit ──────────────────────────────────────────────────────────
  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: 'installment_paid_manual',
    performed_by: user.email,
    details: {
      installment_id: instId,
      label: installment.label,
      amount_cents: installment.amount_cents,
      method,
      note,
      collected_by: collectedBy,
    },
  });

  // ── Cash ledger (cash only) — same alt-pointer pattern as the
  //    booking-level record-payment route. Failure doesn't fail the
  //    payment recording; the audit log already has the trail.
  if (method === 'cash' && installment.amount_cents > 0) {
    try {
      const { data: buyer } = await service
        .from('profiles')
        .select('display_name')
        .eq('user_id', booking.user_id)
        .maybeSingle();
      const buyerName =
        (buyer as { display_name: string } | null)?.display_name ?? 'Unknown';
      await service.from('cash_ledger').insert({
        media_booking_id: id,
        booking_id: null,
        engineer_name: collectedBy,
        amount: installment.amount_cents,
        client_name: buyerName,
        note: note || `Media installment cash payment — ${installment.label}`,
        recorded_by: user.email,
        status: 'owed',
      });
    } catch (e) {
      console.error('[installments/record-payment] cash_ledger insert failed:', e);
    }
  }

  return NextResponse.json({
    success: true,
    method,
    installmentId: instId,
    amountRecorded: installment.amount_cents,
  });
}
