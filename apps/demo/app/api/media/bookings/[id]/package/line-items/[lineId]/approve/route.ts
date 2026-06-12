// app/api/media/bookings/[id]/package/line-items/[lineId]/approve/route.ts
//
// Round 8c: buyer approves a single line item. When every line item in
// the package is approved, the package itself flips to 'approved' and
// the parent booking moves from 'deposited' → 'scheduled' — the cue for
// the rest of the production flow to start.
//
// Only the booking owner (or a band member if booking has band_id) can
// hit this. Admin can also approve on the buyer's behalf if needed
// (handy when scoping over the phone).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendNewMediaMessageNotification } from '@/lib/email';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: bookingId, lineId } = await params;
  const service = createServiceClient();

  // Resolve the booking + verify the user can act as buyer.
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('id, user_id, band_id, status')
    .eq('id', bookingId)
    .maybeSingle();
  if (!bookingRow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const booking = bookingRow as {
    id: string;
    user_id: string;
    band_id: string | null;
    status: string;
  };

  let canApprove = false;
  if (user.role === 'admin') canApprove = true;
  else if (booking.user_id === user.id) canApprove = true;
  else if (booking.band_id) {
    const { data: m } = await service
      .from('band_members')
      .select('id')
      .eq('band_id', booking.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (m) canApprove = true;
  }
  if (!canApprove) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Load the line item + verify it belongs to this booking.
  const { data: lineRow } = await service
    .from('media_booking_line_items')
    .select('id, package_id, label, kind, approval_status')
    .eq('id', lineId)
    .maybeSingle();
  if (!lineRow) {
    return NextResponse.json({ error: 'Line item not found' }, { status: 404 });
  }
  const line = lineRow as {
    id: string;
    package_id: string;
    label: string;
    kind: string;
    approval_status: 'pending' | 'approved' | 'rejected';
  };

  const { data: pkgRow } = await service
    .from('media_booking_packages')
    .select('id, booking_id, status')
    .eq('id', line.package_id)
    .maybeSingle();
  const pkg = pkgRow as { id: string; booking_id: string; status: string } | null;
  if (!pkg || pkg.booking_id !== bookingId) {
    return NextResponse.json({ error: 'Line item does not belong to this booking' }, { status: 400 });
  }
  if (pkg.status !== 'sent' && pkg.status !== 'approved') {
    return NextResponse.json(
      { error: 'Package is still in draft — admin must send it for review first.' },
      { status: 409 },
    );
  }

  // Idempotent: re-approving an approved item is a no-op.
  if (line.approval_status === 'approved') {
    return NextResponse.json({ ok: true, line_item: line, package_status: pkg.status });
  }

  const now = new Date().toISOString();
  const { error: lineUpdErr } = await service
    .from('media_booking_line_items')
    .update({ approval_status: 'approved', approved_at: now })
    .eq('id', lineId);
  if (lineUpdErr) {
    return NextResponse.json(
      { error: `Could not record approval: ${lineUpdErr.message}` },
      { status: 500 },
    );
  }

  await service.from('media_booking_audit_log').insert({
    booking_id: bookingId,
    action: 'line_item_approved',
    performed_by: user.email,
    details: {
      line_item_id: lineId,
      kind: line.kind,
      label: line.label,
    },
  });

  // Check whether all line items are now approved → if so, flip package.
  const { data: allItems } = await service
    .from('media_booking_line_items')
    .select('approval_status')
    .eq('package_id', pkg.id);
  type ApprovalRow = { approval_status: 'pending' | 'approved' | 'rejected' };
  const everyApproved =
    (allItems as ApprovalRow[] | null)?.every((i) => i.approval_status === 'approved') ?? false;

  let packageNowApproved = false;
  if (everyApproved && pkg.status !== 'approved') {
    const { error: pkgFlipErr } = await service
      .from('media_booking_packages')
      .update({
        status: 'approved',
        approved_at: now,
        approved_by: user.id,
      })
      .eq('id', pkg.id);
    if (pkgFlipErr) {
      // Line item was already approved; if the package flip fails we'd
      // leave the buyer in "all items approved but package not approved"
      // limbo — no obvious way to retry from the UI. Surface the error.
      return NextResponse.json(
        { error: `Approval recorded, but package status flip failed: ${pkgFlipErr.message}` },
        { status: 500 },
      );
    }
    packageNowApproved = true;

    // Update parent booking status to 'scheduled' so the rest of the
    // production flow can start — only if it's currently 'deposited'.
    if (booking.status === 'deposited') {
      const { error: bookingFlipErr } = await service
        .from('media_bookings')
        .update({ status: 'scheduled' })
        .eq('id', bookingId);
      if (bookingFlipErr) {
        // Soft-fail: package is approved, parent status drift is a minor
        // bookkeeping issue admin can correct in the dashboard.
        console.error('[approve] booking status flip failed:', bookingFlipErr);
      }
    }

    await service.from('media_booking_audit_log').insert({
      booking_id: bookingId,
      action: 'package_approved',
      performed_by: user.email,
      details: { package_id: pkg.id },
    });

    // Post a system message + notify admins (unified inbox via the mirror —
    // the legacy media_booking_messages table is invisible in the UI).
    const { mirrorToThread } = await import('@/lib/messaging-mirror');
    await mirrorToThread({
      mediaBookingId: bookingId, kind: 'update',
      body: `${user.profile?.display_name ?? 'The buyer'} approved every line item — package is locked. Production can start.`,
    });
    try {
      await sendNewMediaMessageNotification({
        bookingId,
        authorRole: 'buyer',
        authorName: user.profile?.display_name ?? user.email.split('@')[0],
        bodyPreview: 'Approved the full package — production unblocked.',
        hasAttachments: false,
      });
    } catch (e) {
      console.error('[approve] notification failed:', e);
    }
  } else {
    // Partial approval — brief system message so admin sees progress
    // (unified inbox via the mirror).
    const { mirrorToThread } = await import('@/lib/messaging-mirror');
    await mirrorToThread({
      mediaBookingId: bookingId, kind: 'update',
      body: `${user.profile?.display_name ?? 'The buyer'} approved: ${line.label}.`,
    });
  }

  return NextResponse.json({
    ok: true,
    line_item_id: lineId,
    package_now_approved: packageNowApproved,
  });
}
