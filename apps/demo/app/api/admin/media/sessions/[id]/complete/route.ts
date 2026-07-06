// app/api/admin/media/sessions/[id]/complete/route.ts
//
// Admin marks a media session complete. Two things happen:
//   1. status flips to 'completed'
//   2. engineer_payout_cents is recorded (admin types the dollar amount)
//   3. engineer_payout_paid_at = NOW (the row is the payout audit trail)
//
// We deliberately don't auto-compute the payout from a split percentage —
// the migration's split_breakdown is informational, but the actual amount
// owed depends on per-engagement negotiations (Jay's rate on a music
// video can differ from a simple shoot). Admin types the number, the
// system records it.
//
// Cancelled sessions can't be completed via this endpoint — admin would
// uncancel via PATCH first. Already-completed sessions can be re-completed
// (idempotent) which lets admin correct a typo'd payout.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { suggestedMediaCompPayoutCents } from '@/lib/rewards-issue';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Engineer payout — required, integer cents, must be ≥0. We allow 0
  // for sessions that are unpaid (storyboard meetings, marketing chats).
  const payoutRaw = body.engineer_payout_cents;
  if (typeof payoutRaw !== 'number' || !Number.isFinite(payoutRaw) || payoutRaw < 0) {
    return NextResponse.json(
      { error: 'engineer_payout_cents must be a non-negative integer' },
      { status: 400 },
    );
  }
  let payoutCents = Math.round(payoutRaw);

  // Reward comps: if the admin left the payout at $0 on a session funded by a REWARD
  // (free music video/short/photo), auto-pay the team their standard cut of the comped
  // value from the rewards/marketing budget. Non-reward $0 sessions (storyboard/marketing
  // chats) stay $0. Paid work is still admin-typed (per-engagement rates).
  if (payoutCents === 0) {
    try {
      const auto = await suggestedMediaCompPayoutCents(createServiceClient(), id);
      if (auto > 0) payoutCents = auto;
    } catch (e) { console.error('[media complete] comp auto-payout failed (non-fatal):', e); }
  }

  // Optional split breakdown override. If admin provides one, we snapshot
  // it. Otherwise we leave whatever was there (default media split is
  // 15/50/35 platform/editor/coordinator from the migration comments).
  const splitBreakdown = body.split_breakdown ?? null;

  const service = createServiceClient();

  // Verify the session exists and isn't cancelled.
  const { data: existing, error: readErr } = await service
    .from('media_session_bookings')
    .select('id, status, parent_booking_id')
    .eq('id', id)
    .maybeSingle();
  if (readErr || !existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const sessionRow = existing as { id: string; status: string; parent_booking_id: string };
  if (sessionRow.status === 'cancelled') {
    return NextResponse.json(
      { error: 'Cancelled session — uncancel before marking complete' },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {
    status: 'completed',
    engineer_payout_cents: payoutCents,
    engineer_payout_paid_at: new Date().toISOString(),
  };
  if (splitBreakdown) update.split_breakdown = splitBreakdown;

  const { error: updateErr } = await service
    .from('media_session_bookings')
    .update(update)
    .eq('id', id);

  if (updateErr) {
    console.error('[admin/media/sessions/complete] error:', updateErr);
    return NextResponse.json({ error: 'Could not mark complete' }, { status: 500 });
  }

  // If every session under the parent is now completed, advance the parent
  // booking to 'in_production' (production work continues post-shoot for
  // editing) — admin can manually flip to 'delivered' once final files
  // are uploaded. We don't auto-flip to 'delivered' because that's
  // explicitly a "we shipped it" decision, not a "we shot it" decision.
  const { data: siblings } = await service
    .from('media_session_bookings')
    .select('status')
    .eq('parent_booking_id', sessionRow.parent_booking_id);
  const allDone = (siblings || []).length > 0 &&
    (siblings as Array<{ status: string }>).every(
      (r) => r.status === 'completed' || r.status === 'cancelled',
    );
  if (allDone) {
    // Only advance from earlier states; never demote 'delivered' back.
    await service
      .from('media_bookings')
      .update({ status: 'in_production' })
      .eq('id', sessionRow.parent_booking_id)
      .in('status', ['scheduled', 'deposited']);
  }

  return NextResponse.json({ ok: true });
}
