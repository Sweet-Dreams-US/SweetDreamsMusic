// app/api/admin/media/bookings/[id]/installments/route.ts
//
// Media Projects — the installment PLAN for a booking.
//
//   GET  → list the booking's installments (display/pay order). Used by
//          the admin project-detail UI. Returns [] for legacy bookings
//          with no plan.
//
//   POST → create / REPLACE the plan from an array of stints:
//            { installments: [{ label, amount_cents, due_date? }, ...] }
//          Rules:
//            • SUM(amount_cents) must equal media_bookings.final_price_cents
//              (exact) — 400 otherwise with a clear message.
//            • Replace is only allowed while NO stint is `paid` or
//              `link_sent` (a "locked" plan) — 409 otherwise.
//            • Rows are inserted with sort_order = array index.
//          Audit: `payment_plan_set`.
//
// Admin-gated (getSessionUser + role === 'admin'), mirroring the other
// admin media routes (charge-remainder, record-payment, manual).
//
// ADDITIVE: writing a plan does NOT change any existing media_bookings
// column. The deposit/remainder flow is untouched — paid-so-far for a plan
// project is derived from SUM(paid installments), computed by readers.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  getInstallmentsForBooking,
  planIsLocked,
} from '@/lib/media-installments-server';

type IncomingStint = {
  label: string;
  amount_cents: number;
  due_date: string | null;
};

// ============================================================
// GET — list installments for the booking
// ============================================================
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;
  const service = createServiceClient();

  // Confirm the booking exists so the UI gets a clean 404 vs an empty list
  // that looks like "no plan".
  const { data: booking } = await service
    .from('media_bookings')
    .select('id, final_price_cents')
    .eq('id', id)
    .maybeSingle();
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const installments = await getInstallmentsForBooking(id, service);
  return NextResponse.json({
    installments,
    final_price_cents: (booking as { final_price_cents: number }).final_price_cents,
  });
}

// ============================================================
// POST — create / replace the plan
// ============================================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Accept { installments: [...] } or a bare array for convenience.
  const rawList = Array.isArray(body) ? body : body.installments;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return NextResponse.json(
      { error: 'installments must be a non-empty array of { label, amount_cents, due_date? }' },
      { status: 400 },
    );
  }

  // ── Validate + normalize each stint ────────────────────────────────
  const stints: IncomingStint[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i] as Record<string, unknown>;
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    const amount = raw?.amount_cents;
    if (!label) {
      return NextResponse.json(
        { error: `Installment #${i + 1}: label is required` },
        { status: 400 },
      );
    }
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
      return NextResponse.json(
        { error: `Installment #${i + 1}: amount_cents must be a non-negative integer` },
        { status: 400 },
      );
    }
    // due_date: optional. Accept 'YYYY-MM-DD' or null/empty.
    let dueDate: string | null = null;
    if (raw?.due_date != null && raw.due_date !== '') {
      const ds = String(raw.due_date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        return NextResponse.json(
          { error: `Installment #${i + 1}: due_date must be YYYY-MM-DD or omitted` },
          { status: 400 },
        );
      }
      dueDate = ds;
    }
    stints.push({ label, amount_cents: amount, due_date: dueDate });
  }

  const service = createServiceClient();

  // ── Load the booking to validate the sum against its total ─────────
  const { data: bookingRow, error: bookingErr } = await service
    .from('media_bookings')
    .select('id, final_price_cents')
    .eq('id', id)
    .maybeSingle();
  if (bookingErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  const finalPrice = (bookingRow as { final_price_cents: number }).final_price_cents;

  const sum = stints.reduce((acc, s) => acc + s.amount_cents, 0);
  if (sum !== finalPrice) {
    return NextResponse.json(
      {
        error: `Installment amounts must sum to the project total. Plan sums to ${sum} cents but the project total is ${finalPrice} cents (off by ${sum - finalPrice}).`,
        sum_cents: sum,
        final_price_cents: finalPrice,
      },
      { status: 400 },
    );
  }

  // ── Guard: don't blow away a plan that's already in motion ─────────
  const existing = await getInstallmentsForBooking(id, service);
  if (planIsLocked(existing)) {
    return NextResponse.json(
      {
        error:
          'This plan can no longer be replaced — at least one installment is already paid or has a sent payment link. Adjust the remaining stints individually.',
      },
      { status: 409 },
    );
  }

  // ── Replace: delete the (all-pending) existing rows, insert the new plan ──
  if (existing.length > 0) {
    const { error: delErr } = await service
      .from('media_payment_installments')
      .delete()
      .eq('booking_id', id);
    if (delErr) {
      console.error('[installments] delete old plan error:', delErr);
      return NextResponse.json(
        { error: `Could not replace plan: ${delErr.message}` },
        { status: 500 },
      );
    }
  }

  const insertRows = stints.map((s, idx) => ({
    booking_id: id,
    sort_order: idx,
    label: s.label,
    amount_cents: s.amount_cents,
    due_date: s.due_date,
    status: 'pending' as const,
  }));

  const { data: inserted, error: insErr } = await service
    .from('media_payment_installments')
    .insert(insertRows)
    .select(
      'id, booking_id, sort_order, label, amount_cents, due_date, status, paid_at, paid_method',
    );
  if (insErr) {
    console.error('[installments] insert plan error:', insErr);
    return NextResponse.json(
      { error: `Could not save plan: ${insErr.message}` },
      { status: 500 },
    );
  }

  // ── Audit ──────────────────────────────────────────────────────────
  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: 'payment_plan_set',
    performed_by: user.email,
    details: {
      installment_count: stints.length,
      total_cents: sum,
      replaced_existing: existing.length > 0,
      stints: stints.map((s) => ({
        label: s.label,
        amount_cents: s.amount_cents,
        due_date: s.due_date,
      })),
    },
  });

  return NextResponse.json({ success: true, installments: inserted });
}
