// app/api/messages/threads/from-booking/[bookingId]/route.ts
//
// Resolve a media booking's thread id, creating one lazily on first
// access if none exists yet. Used by the legacy MessageThread component
// (which is keyed on bookingId) so it can defer to the new /api/messages
// endpoints once we have a thread_id.
//
// Idempotent: re-calling returns the same thread_id thanks to the
// UNIQUE index on (media_booking_id) WHERE kind='media_booking'.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { bookingId } = await params;
  const service = createServiceClient();

  // Verify the user has SOME claim on this booking before creating
  // anything. Same access pattern as Round 8b's resolveViewerRole.
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('id, user_id, band_id')
    .eq('id', bookingId)
    .maybeSingle();
  const booking = bookingRow as { id: string; user_id: string; band_id: string | null } | null;
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  let hasAccess = false;
  if (user.role === 'admin') hasAccess = true;
  else if (user.role === 'engineer') hasAccess = true;
  else if (booking.user_id === user.id) hasAccess = true;
  else if (booking.band_id) {
    const { data: m } = await service
      .from('band_members')
      .select('id')
      .eq('band_id', booking.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (m) hasAccess = true;
  }
  if (!hasAccess) {
    const { data: s } = await service
      .from('media_session_bookings')
      .select('id')
      .eq('parent_booking_id', bookingId)
      .eq('engineer_id', user.id)
      .limit(1)
      .maybeSingle();
    if (s) hasAccess = true;
  }
  if (!hasAccess) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Look for existing thread; insert if missing.
  const { data: existing } = await service
    .from('message_threads')
    .select('id')
    .eq('kind', 'media_booking')
    .eq('media_booking_id', bookingId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ thread_id: (existing as { id: string }).id });
  }

  const { data: created, error } = await service
    .from('message_threads')
    .insert({
      kind: 'media_booking',
      media_booking_id: bookingId,
      subject: 'Booking conversation',
    })
    .select('id')
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: `Could not create thread: ${error?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ thread_id: (created as { id: string }).id });
}
