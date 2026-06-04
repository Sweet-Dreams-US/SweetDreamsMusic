// app/api/admin/media/bookings/[id]/component-complete/route.ts
//
// Admin marks a single component (slot) of a media booking as complete
// AND optionally attaches a Google Drive link for the buyer to download.
// On the first time a component flips to complete with a Drive URL, we
// send the buyer a "your X is ready" email.
//
// Body: {
//   slot_key: string,             // matches offering.components.slots[].key
//   completed: boolean,           // toggle on/off
//   drive_url?: string,           // optional Drive link
//   notify_buyer?: boolean        // default true when completed=true and drive_url present
// }
//
// Idempotent: re-marking a completed slot just updates the timestamp +
// Drive URL. The notification email only fires once per slot — we
// stamp `notified_at` on the row and skip the email if it's already
// been sent (admin can force-resend by null'ing notified_at first via
// a future "resend" endpoint, but that's not in this round).

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendMediaComponentReady } from '@/lib/email';

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

  const slotKey = typeof body.slot_key === 'string' ? body.slot_key.trim() : '';
  const completed = body.completed === true;
  const driveUrl = typeof body.drive_url === 'string' ? body.drive_url.trim() : '';
  const notifyBuyer = body.notify_buyer !== false; // default true

  if (!slotKey) {
    return NextResponse.json({ error: 'slot_key required' }, { status: 400 });
  }
  if (driveUrl && !/^https?:\/\//i.test(driveUrl)) {
    return NextResponse.json(
      { error: 'drive_url must be an http(s) URL' },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: bookingRow, error: readErr } = await service
    .from('media_bookings')
    .select('id, offering_id, user_id, band_id, component_status, status')
    .eq('id', id)
    .maybeSingle();
  if (readErr || !bookingRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  type Row = {
    id: string;
    offering_id: string;
    user_id: string;
    band_id: string | null;
    component_status: Record<string, unknown> | null;
    status: string;
  };
  const booking = bookingRow as Row;

  // Validate the slot_key against the offering's slot schema so we
  // don't accept arbitrary keys that admin typo'd.
  const { data: offeringRow } = await service
    .from('media_offerings')
    .select('title, components')
    .eq('id', booking.offering_id)
    .maybeSingle();
  type Offering = {
    title: string;
    components: { slots?: Array<{ key: string; label: string }> } | null;
  };
  const offering = offeringRow as Offering | null;
  const slot = offering?.components?.slots?.find((s) => s.key === slotKey);
  if (!slot) {
    return NextResponse.json(
      { error: `Slot "${slotKey}" not found on offering` },
      { status: 400 },
    );
  }

  // ── Update component_status JSONB ──────────────────────────────────
  const prevStatus = (booking.component_status as Record<string, {
    completed?: boolean;
    completed_at?: string;
    completed_by?: string;
    drive_url?: string;
    notified_at?: string | null;
  }>) ?? {};
  const prevSlot = prevStatus[slotKey] ?? {};

  const now = new Date().toISOString();
  const nextSlot = {
    ...prevSlot,
    completed,
    completed_at: completed ? prevSlot.completed_at ?? now : null,
    completed_by: completed ? user.email : null,
    drive_url: driveUrl || prevSlot.drive_url || null,
    // Don't reset notified_at when marking incomplete — preserves the
    // record of "we sent an email at some point"
    notified_at: prevSlot.notified_at ?? null,
  };

  const newStatus = { ...prevStatus, [slotKey]: nextSlot };

  const { error: updErr } = await service
    .from('media_bookings')
    .update({ component_status: newStatus })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json(
      { error: `Could not update component status: ${updErr.message}` },
      { status: 500 },
    );
  }

  // ── Buyer notification ─────────────────────────────────────────────
  // Only fires when:
  //   - completed flipped to true (this call)
  //   - Drive URL is present
  //   - notifyBuyer flag is set (default)
  //   - We haven't already sent the email for this slot
  let emailSent = false;
  const shouldNotify =
    completed && !!nextSlot.drive_url && notifyBuyer && !prevSlot.notified_at;
  if (shouldNotify) {
    const { data: buyer } = await service
      .from('profiles')
      .select('email, display_name')
      .eq('user_id', booking.user_id)
      .maybeSingle();
    const buyerProfile = buyer as { email: string | null; display_name: string } | null;
    if (buyerProfile?.email) {
      try {
        await sendMediaComponentReady(buyerProfile.email, {
          buyerName: buyerProfile.display_name,
          offeringTitle: offering?.title ?? 'your media order',
          componentLabel: slot.label,
          driveUrl: nextSlot.drive_url!,
          bookingId: id,
        });
        // Stamp notified_at so we don't double-send if admin re-clicks.
        const stampedStatus = {
          ...newStatus,
          [slotKey]: { ...nextSlot, notified_at: now },
        };
        await service
          .from('media_bookings')
          .update({ component_status: stampedStatus })
          .eq('id', id);
        emailSent = true;
      } catch (e) {
        console.error('[component-complete] email error:', e);
      }
    }
  }

  // ── Audit ──────────────────────────────────────────────────────────
  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: completed ? 'component_completed' : 'component_uncompleted',
    performed_by: user.email,
    details: {
      slot_key: slotKey,
      slot_label: slot.label,
      drive_url: nextSlot.drive_url,
      notification_sent: emailSent,
    },
  });

  return NextResponse.json({
    success: true,
    slot_key: slotKey,
    completed,
    drive_url: nextSlot.drive_url,
    notification_sent: emailSent,
  });
}
