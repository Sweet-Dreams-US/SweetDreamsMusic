// app/api/media/bookings/[id]/sessions/[sessionId]/approve/route.ts
//
// Round 8d: the OTHER side of the proposal cycle approves a date.
// Proposals from buyer get approved by admin (and vice versa). Status
// flips proposed → scheduled. If admin's the approver, they assign the
// engineer here too (required for studio sessions).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { fmtStampDateTime } from '@/lib/studio-time';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: bookingId, sessionId } = await params;

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* body is optional for approval */ }
  const engineerId = typeof body.engineer_id === 'string' ? body.engineer_id : null;

  const service = createServiceClient();

  // Resolve role + verify access.
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('user_id, band_id')
    .eq('id', bookingId)
    .maybeSingle();
  const booking = bookingRow as { user_id: string; band_id: string | null } | null;
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let role: 'admin' | 'buyer' | null = null;
  if (user.role === 'admin') role = 'admin';
  else if (booking.user_id === user.id) role = 'buyer';
  else if (booking.band_id) {
    const { data: m } = await service.from('band_members')
      .select('id').eq('band_id', booking.band_id).eq('user_id', user.id).maybeSingle();
    if (m) role = 'buyer';
  }
  if (!role) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  // Load the session.
  const { data: sessRow } = await service
    .from('media_session_bookings')
    .select('id, parent_booking_id, line_item_id, status, proposed_by, starts_at, ends_at, location, engineer_id, session_kind')
    .eq('id', sessionId)
    .maybeSingle();
  const session = sessRow as {
    id: string;
    parent_booking_id: string;
    line_item_id: string | null;
    status: string;
    proposed_by: 'admin' | 'buyer' | null;
    starts_at: string;
    ends_at: string;
    location: string;
    engineer_id: string | null;
    session_kind: string;
  } | null;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (session.parent_booking_id !== bookingId) {
    return NextResponse.json({ error: 'Session does not belong to this booking' }, { status: 400 });
  }
  if (session.status !== 'proposed') {
    return NextResponse.json({ error: `Cannot approve session with status '${session.status}'` }, { status: 409 });
  }

  // The approver must be the OPPOSITE side of who proposed.
  const proposedBy = session.proposed_by;
  if (proposedBy === role) {
    return NextResponse.json(
      { error: `You proposed this date — wait for the other side to approve, or counter-propose with a different time.` },
      { status: 409 },
    );
  }

  // Engineer assignment for studio + filming sessions. Admin must specify
  // an engineer; buyer-side approval doesn't change engineer (admin set
  // it on their proposal, or admin will set on counter-approval).
  let finalEngineerId = session.engineer_id;
  if (role === 'admin' && engineerId) {
    finalEngineerId = engineerId;
  }
  if (!finalEngineerId && session.session_kind !== 'planning_call' && session.session_kind !== 'design_meeting') {
    // Non-call sessions need an engineer at scheduled time. Calls don't.
    return NextResponse.json(
      { error: 'Engineer required to schedule this session kind. Admin must approve with engineer_id set.' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { error: updErr } = await service
    .from('media_session_bookings')
    .update({
      status: 'scheduled',
      approved_at: now,
      approved_by: user.id,
      engineer_id: finalEngineerId,
    })
    .eq('id', sessionId);
  if (updErr) {
    return NextResponse.json({ error: `Could not approve: ${updErr.message}` }, { status: 500 });
  }

  // Mark any sibling proposals on the same line item that are still
  // 'proposed' as superseded. Without this, two proposals can both look
  // active and the UI gets confused. Filtered by line_item_id (and the
  // approved row's id is excluded) so we don't accidentally cancel
  // unrelated sessions on this booking.
  if (session.line_item_id) {
    const { error: superErr } = await service
      .from('media_session_bookings')
      .update({ status: 'superseded' })
      .eq('line_item_id', session.line_item_id)
      .eq('status', 'proposed')
      .neq('id', sessionId);
    if (superErr) {
      console.error('[session-approve] superseding sibling proposals failed:', superErr);
    }
  }

  await service.from('media_booking_audit_log').insert({
    booking_id: bookingId,
    action: 'session_approved',
    performed_by: user.email,
    details: {
      session_id: sessionId,
      line_item_id: session.line_item_id,
      starts_at: session.starts_at,
      approved_by_role: role,
      engineer_id: finalEngineerId,
    },
  });

  // System message in chat.
  const startLabel = fmtStampDateTime(session.starts_at, { weekday: 'short' });
  const approverName = user.profile?.display_name ?? user.email.split('@')[0];
  // Unified inbox (Plan 4): write via the mirror — the legacy table is
  // invisible in the UI.
  const { mirrorToThread } = await import('@/lib/messaging-mirror');
  await mirrorToThread({
    mediaBookingId: bookingId, kind: 'update',
    body: `${approverName} approved ${startLabel} — session is scheduled.`,
  });

  try {
    const { sendNewMediaMessageNotification } = await import('@/lib/email');
    await sendNewMediaMessageNotification({
      bookingId,
      authorRole: role,
      authorName: approverName,
      bodyPreview: `Approved ${startLabel} — session locked.`,
      hasAttachments: false,
    });
  } catch (e) { console.error('[session-approve] notification failed:', e); }

  return NextResponse.json({ ok: true, session_id: sessionId, status: 'scheduled' });
}
