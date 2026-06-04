// app/api/admin/media/bookings/[id]/line-items/[lineId]/complete/route.ts
//
// Round 8e: admin marks a line item complete and optionally pastes a
// Google Drive URL. On the first time this combo lands, the buyer gets
// a "your X is ready" email. notified_at stamps the row so re-clicks
// don't re-spam.
//
// Mirrors the older /component-complete route which keyed on offering
// slot keys. The new wiring keys on line item ids — once Round 8e is
// adopted across all bookings, the slot-based route can be deprecated.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendMediaComponentReady } from '@/lib/email';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id: bookingId, lineId } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const completed = body.completed !== false; // default true
  // Distinguish "drive_url not provided" (leave alone) from "drive_url:''" (explicitly clear)
  // by checking whether the key was present at all on the body.
  const driveUrlProvided = typeof body.drive_url === 'string';
  const driveUrl = driveUrlProvided ? (body.drive_url as string).trim() : '';
  const notifyBuyer = body.notify_buyer !== false; // default true when completing

  if (driveUrl && !/^https?:\/\//i.test(driveUrl)) {
    return NextResponse.json({ error: 'drive_url must start with http:// or https://' }, { status: 400 });
  }

  const service = createServiceClient();

  // Load the line item + verify booking match.
  const { data: lineRow } = await service
    .from('media_booking_line_items')
    .select('id, package_id, kind, label, drive_url, completed, notified_at')
    .eq('id', lineId)
    .maybeSingle();
  const line = lineRow as {
    id: string;
    package_id: string;
    kind: string;
    label: string;
    drive_url: string | null;
    completed: boolean;
    notified_at: string | null;
  } | null;
  if (!line) return NextResponse.json({ error: 'Line item not found' }, { status: 404 });

  const { data: pkgRow } = await service
    .from('media_booking_packages')
    .select('booking_id')
    .eq('id', line.package_id)
    .maybeSingle();
  const pkg = pkgRow as { booking_id: string } | null;
  if (!pkg || pkg.booking_id !== bookingId) {
    return NextResponse.json({ error: 'Line item does not belong to this booking' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    completed,
    completed_by: completed ? user.id : null,
  };
  // completed_at: stamp on FIRST completion. Re-marking an already-completed
  // item shouldn't reset the timestamp (preserves history). Un-completing
  // clears it because the next completion is conceptually a new delivery.
  if (completed) {
    if (!line.completed) updates.completed_at = now;
    // else: leave existing completed_at alone — `updates` doesn't carry the key.
  } else {
    updates.completed_at = null;
  }
  // Drive URL: only mutate the column if the caller explicitly sent the
  // key. Sending an empty string clears it (admin "clear" UX); omitting
  // the key leaves the existing URL alone.
  if (driveUrlProvided) {
    updates.drive_url = driveUrl || null;
  }

  const { error: updErr } = await service
    .from('media_booking_line_items')
    .update(updates)
    .eq('id', lineId);
  if (updErr) {
    return NextResponse.json({ error: `Could not update: ${updErr.message}` }, { status: 500 });
  }

  // Buyer notification: only fires when
  //   • completed flipped to true (this call)
  //   • Drive URL is present (passed-in OR already on the row)
  //   • notifyBuyer flag set (default true)
  //   • Not already notified for this completion
  // If admin explicitly cleared the URL (sent empty string), use null;
  // otherwise fall back to the existing row's URL.
  const finalDriveUrl = driveUrlProvided
    ? (driveUrl || null)
    : (line.drive_url || null);
  let emailSent = false;
  const shouldNotify = completed && !!finalDriveUrl && notifyBuyer && !line.notified_at;
  if (shouldNotify) {
    // Resolve buyer + offering title for the email copy.
    const { data: bookingRow } = await service
      .from('media_bookings')
      .select('user_id, offering_id')
      .eq('id', bookingId)
      .maybeSingle();
    const booking = bookingRow as { user_id: string; offering_id: string } | null;
    if (booking) {
      const { data: profile } = await service
        .from('profiles')
        .select('display_name')
        .eq('user_id', booking.user_id)
        .maybeSingle();
      const buyerName = (profile as { display_name: string } | null)?.display_name ?? 'there';

      let buyerEmail: string | null = null;
      try {
        const { data: u } = await service.auth.admin.getUserById(booking.user_id);
        buyerEmail = u?.user?.email ?? null;
      } catch { /* */ }

      const { data: offering } = await service
        .from('media_offerings')
        .select('title')
        .eq('id', booking.offering_id)
        .maybeSingle();
      const offeringTitle = (offering as { title: string } | null)?.title ?? 'your media order';

      if (buyerEmail) {
        try {
          await sendMediaComponentReady(buyerEmail, {
            buyerName,
            offeringTitle,
            componentLabel: line.label,
            driveUrl: finalDriveUrl,
            bookingId,
          });
          await service
            .from('media_booking_line_items')
            .update({ notified_at: now })
            .eq('id', lineId);
          emailSent = true;
        } catch (e) {
          console.error('[line-item/complete] email failed:', e);
        }
      }
    }
  }

  await service.from('media_booking_audit_log').insert({
    booking_id: bookingId,
    action: completed ? 'line_item_completed' : 'line_item_uncompleted',
    performed_by: user.email,
    details: {
      line_item_id: lineId,
      kind: line.kind,
      label: line.label,
      drive_url: finalDriveUrl,
      notification_sent: emailSent,
    },
  });

  // For the response, look up the actual completed_at from the row so the
  // client gets the truth (helpful when re-completing — UI can show original
  // delivery date). Tiny extra read; cheap and correct.
  const { data: refreshed } = await service
    .from('media_booking_line_items')
    .select('completed_at')
    .eq('id', lineId)
    .maybeSingle();
  const responseCompletedAt =
    (refreshed as { completed_at: string | null } | null)?.completed_at ?? null;

  return NextResponse.json({
    ok: true,
    line_item_id: lineId,
    completed,
    completed_at: responseCompletedAt,
    drive_url: finalDriveUrl,
    notification_sent: emailSent,
  });
}
