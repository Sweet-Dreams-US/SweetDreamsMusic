import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { getStudioConfig } from '@/lib/studio-config-server';

// PATCH — engineer/admin updates guest count for a booking
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId, guestCount: rawCount } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  const serviceClient = createServiceClient();

  // Get current booking
  const { data: booking, error } = await serviceClient
    .from('bookings')
    .select('id, room, duration, total_amount, remainder_amount, guest_count, guest_fee_amount')
    .eq('id', bookingId)
    .single();

  if (error || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // DB-driven guest rules (studio_rooms), constants fallback baked in — so an
  // admin's per-room free-guest / fee / max changes cascade to mid-session edits.
  const studioConfig = await getStudioConfig(serviceClient, booking.room);
  const guestCount = Math.min(Math.max(1, Number(rawCount) || 1), studioConfig.maxGuests);

  // Calculate new guest fee
  const extraGuests = Math.max(0, guestCount - studioConfig.freeGuests);
  const newGuestFee = extraGuests * studioConfig.guestFeeCents * booking.duration;
  const oldGuestFee = booking.guest_fee_amount || 0;
  const feeDiff = newGuestFee - oldGuestFee;

  // Update total and remainder
  const newTotal = booking.total_amount + feeDiff;
  const newRemainder = booking.remainder_amount + feeDiff;

  const { error: updateError } = await serviceClient
    .from('bookings')
    .update({
      guest_count: guestCount,
      guest_fee_amount: newGuestFee,
      total_amount: newTotal,
      remainder_amount: Math.max(0, newRemainder),
    })
    .eq('id', bookingId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    guestCount,
    guestFee: newGuestFee,
    totalAmount: newTotal,
    remainderAmount: Math.max(0, newRemainder),
    feeDiff,
  });
}
