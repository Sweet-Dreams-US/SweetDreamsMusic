// app/api/booking/[id]/correct-cash/route.ts
//
// PATCH — correct the cash collected amount on a booking after the
// session has ended. Engineers and admins can both call this, with the
// constraint that engineers can only correct their own sessions.
//
// Why this endpoint exists: the existing booking flow lets the engineer
// record cash + complete the session, but doesn't let them edit the
// amount afterward. When a customer ends early or pays a different
// amount than originally booked, the engineer's only recourse is to
// ask admin to fix it manually in the database. This endpoint formalizes
// that path with a required reason + audit log.
//
// Body:
//   { new_total_cents: number, reason: string }
//
// Side effects (atomic-ish):
//   1. Insert booking_cash_corrections row (audit log entry)
//   2. Update bookings.total_amount
//   3. Update cash_ledger.amount (if a row exists for this booking)
//
// Constraints:
//   • Booking must be a CASH booking — payments via Stripe (deposit OR
//     remainder) cannot be hand-edited via this endpoint, since
//     they're already reconciled with Stripe. Stripe-side refunds
//     are a separate flow.
//   • new_total_cents must be ≥ 0 and ≤ 9999900 ($99,999 sanity cap).
//   • Reason must be ≥ 5 chars (CHECK constraint also enforces).
//   • Engineer caller must own the session (matches engineer_name OR
//     requested_engineer when claimed). Admin bypasses this.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { findEngineerByEmail, isSameEngineer } from '@/lib/constants';

interface CorrectCashBody {
  new_total_cents?: number;
  reason?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: CorrectCashBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (typeof body.new_total_cents !== 'number' || body.new_total_cents < 0 || body.new_total_cents > 9999900) {
    return NextResponse.json({ error: 'new_total_cents must be 0-9999900 (cents).' }, { status: 400 });
  }
  if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length < 5) {
    return NextResponse.json({ error: 'reason is required (5+ characters).' }, { status: 400 });
  }
  const reason = body.reason.trim();
  const newTotal = Math.round(body.new_total_cents);

  const service = createServiceClient();

  // Pull booking + verify it's a cash session.
  const { data: bookingRow, error: bErr } = await service
    .from('bookings')
    .select('id, total_amount, status, engineer_name, requested_engineer, customer_email, stripe_payment_intent_id, stripe_checkout_session_id, deposit_amount, actual_deposit_paid, package_entitlement_id')
    .eq('id', id)
    .maybeSingle();
  if (bErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  type Booking = {
    id: string; total_amount: number; status: string;
    engineer_name: string | null; requested_engineer: string | null;
    customer_email: string;
    stripe_payment_intent_id: string | null;
    stripe_checkout_session_id: string | null;
    deposit_amount: number;
    actual_deposit_paid: number | null;
    package_entitlement_id: string | null;
  };
  const booking = bookingRow as Booking;

  // Block Stripe-paid sessions — those reconcile through the webhook
  // and need a Stripe refund flow, not a hand-edit.
  if (booking.stripe_payment_intent_id || booking.stripe_checkout_session_id) {
    return NextResponse.json(
      { error: 'This booking was paid via Stripe — refunds must go through the Stripe flow, not cash correction.' },
      { status: 400 },
    );
  }
  // Block package-entitlement bookings (those have $0 total by design;
  // correcting them is meaningless and would corrupt the entitlement
  // accounting).
  if (booking.package_entitlement_id) {
    return NextResponse.json(
      { error: 'This booking redeemed a package entitlement — total can\'t be corrected.' },
      { status: 400 },
    );
  }

  // Authorize: admin always; engineer only for their own session.
  const isAdmin = user.role === 'admin';
  let isOwnSession = false;
  if (!isAdmin) {
    const engineerEntry = findEngineerByEmail(user.email);
    if (engineerEntry) {
      // Match either engineer_name (post-claim) or requested_engineer
      // (pre-claim, in case a same-day session was completed without
      // a formal claim event).
      isOwnSession = isSameEngineer(user.email, user.profile?.display_name ?? null, booking.engineer_name)
        || isSameEngineer(user.email, user.profile?.display_name ?? null, booking.requested_engineer);
    }
  }
  if (!isAdmin && !isOwnSession) {
    return NextResponse.json(
      { error: 'Only the assigned engineer or an admin can correct this session.' },
      { status: 403 },
    );
  }

  // Pull existing cash_ledger row (may not exist if this was a future
  // booking the engineer never recorded cash for — in which case we
  // just update bookings without touching ledger).
  const { data: ledgerRow } = await service
    .from('cash_ledger')
    .select('id, amount')
    .eq('booking_id', id)
    .maybeSingle();
  type Ledger = { id: string; amount: number };
  const ledger = ledgerRow as Ledger | null;

  // No-op if nothing changes.
  if (newTotal === booking.total_amount && (ledger?.amount === newTotal || !ledger)) {
    return NextResponse.json({ ok: true, noChange: true });
  }

  // ── Insert audit log row FIRST. If anything below fails, the audit
  // log proves the intent and admin can finish the correction
  // manually. ───────────────────────────────────────────────────────
  const { error: auditErr } = await service.from('booking_cash_corrections').insert({
    booking_id: id,
    previous_total_cents: booking.total_amount,
    previous_cash_ledger_amount_cents: ledger?.amount ?? null,
    new_total_cents: newTotal,
    new_cash_ledger_amount_cents: newTotal, // we sync them
    reason,
    corrected_by_user_id: user.id,
    corrected_by_email: user.email,
    corrected_by_role: isAdmin ? 'admin' : 'engineer',
  });
  if (auditErr) {
    console.error('[correct-cash] audit insert failed:', auditErr);
    return NextResponse.json({ error: auditErr.message }, { status: 500 });
  }

  // ── Update bookings.total_amount + append correction note ────────
  // Read existing admin_notes first so we can append (preserving
  // history), then write everything in a single UPDATE.
  const { data: notesRow } = await service
    .from('bookings').select('admin_notes').eq('id', id).single();
  const existingNotes = (notesRow as { admin_notes: string | null } | null)?.admin_notes ?? '';
  const correctionLine = `\n\n[CASH CORRECTION ${new Date().toISOString().slice(0, 10)} by ${user.email}] $${(booking.total_amount / 100).toFixed(2)} → $${(newTotal / 100).toFixed(2)}. Reason: ${reason}`;
  const { error: bookingErr } = await service
    .from('bookings')
    .update({
      total_amount: newTotal,
      admin_notes: existingNotes + correctionLine,
    })
    .eq('id', id);
  if (bookingErr) {
    console.error('[correct-cash] booking update failed:', bookingErr);
    return NextResponse.json({ error: bookingErr.message }, { status: 500 });
  }

  // ── Update cash_ledger if it exists ───────────────────────────────
  if (ledger) {
    const { error: ledgerErr } = await service
      .from('cash_ledger')
      .update({
        amount: newTotal,
        collected_note: `Updated by ${user.email} on ${new Date().toISOString().slice(0, 10)}: ${reason}`,
      })
      .eq('id', ledger.id);
    if (ledgerErr) {
      console.error('[correct-cash] cash_ledger update failed:', ledgerErr);
      // Booking and audit are already updated. Surface but don't
      // rollback (admin sees the audit log + can manually fix the
      // ledger). Return 207 to indicate partial success.
      return NextResponse.json(
        {
          ok: true,
          warning: 'Booking updated and audit logged, but cash_ledger update failed. Admin should reconcile manually.',
        },
        { status: 207 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    booking_id: id,
    new_total_cents: newTotal,
    audit_logged: true,
  });
}
