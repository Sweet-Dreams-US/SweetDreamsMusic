// app/api/media/bookings/[id]/package/send/route.ts
//
// Round 8c: admin flips package status from 'draft' → 'sent', stamps
// proposed_at, posts a system message into the chat thread so the buyer
// has context, and fires an email digest so they come check the order.
//
// Idempotent: calling on an already-sent package is a no-op (returns OK
// with the existing proposed_at).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendNewMediaMessageNotification } from '@/lib/email';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;
  const service = createServiceClient();

  const { data: pkgRow } = await service
    .from('media_booking_packages')
    .select('id, status, total_cents, proposed_at')
    .eq('booking_id', id)
    .maybeSingle();
  const pkg = pkgRow as {
    id: string;
    status: 'draft' | 'sent' | 'approved';
    total_cents: number;
    proposed_at: string | null;
  } | null;

  if (!pkg) {
    return NextResponse.json(
      { error: 'No package on this booking yet — build one first.' },
      { status: 404 },
    );
  }
  if (pkg.status === 'approved') {
    return NextResponse.json(
      { error: 'Package already approved.' },
      { status: 409 },
    );
  }
  if (pkg.status === 'sent') {
    // Idempotent — re-send is meaningless if nothing changed, but we'll
    // still post a fresh chat message so the buyer's reminded.
    await postSystemAndNotify(service, id, user, pkg.total_cents, /*resend*/ true);
    return NextResponse.json({ ok: true, status: 'sent', resent: true });
  }

  // draft → sent
  const now = new Date().toISOString();
  const { error: updErr } = await service
    .from('media_booking_packages')
    .update({ status: 'sent', proposed_at: now })
    .eq('id', pkg.id);
  if (updErr) {
    return NextResponse.json(
      { error: `Could not flip status: ${updErr.message}` },
      { status: 500 },
    );
  }

  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: 'package_sent',
    performed_by: user.email,
    details: { package_id: pkg.id, total_cents: pkg.total_cents },
  });

  await postSystemAndNotify(service, id, user, pkg.total_cents, false);

  return NextResponse.json({ ok: true, status: 'sent' });
}

async function postSystemAndNotify(
  service: ReturnType<typeof createServiceClient>,
  bookingId: string,
  user: { email: string; profile?: { display_name?: string } | null },
  totalCents: number,
  resend: boolean,
) {
  const adminName = user.profile?.display_name || user.email.split('@')[0];
  const dollars = (totalCents / 100).toFixed(2);
  const verb = resend ? 're-sent' : 'sent';
  const body = `${adminName} ${verb} a proposed package for your review — total $${dollars}. Approve each line item or use this thread to request changes.`;

  // Unified inbox (Plan 4): write to `messages` via the mirror — the legacy
  // media_booking_messages table is read-only history and invisible in the UI.
  const { mirrorToThread } = await import('@/lib/messaging-mirror');
  await mirrorToThread({ mediaBookingId: bookingId, kind: 'update', body });

  // Buyer notification — same digest used for regular chat messages.
  try {
    await sendNewMediaMessageNotification({
      bookingId,
      authorRole: 'admin',
      authorName: adminName,
      bodyPreview: body,
      hasAttachments: false,
    });
  } catch (e) {
    console.error('[package/send] notification failed:', e);
  }
}
