// app/api/media/sessions/[id]/route.ts
//
// Per-session operations. DELETE soft-cancels (sets status='cancelled').
// We don't expose PATCH yet — admins can edit via Supabase MCP, and the
// Phase D MVP rule is "cancel + reschedule" rather than in-place edit.
// Reschedule UI ships in Phase D.2.
//
// Auth: user must own the parent booking (or be a band member). Engineers
// don't own sessions — they're assigned, not owners — so they can't cancel
// from this endpoint. Engineer-side cancel goes through the admin tab.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getUserBands } from '@/lib/bands-server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  // Load the session + its parent so we can check ownership and gate cancel
  // by current status. Cancelling a completed session is suspicious and
  // should require admin review — we 400 here.
  const { data: session, error: readErr } = await service
    .from('media_session_bookings')
    .select('id, status, parent_booking_id')
    .eq('id', id)
    .maybeSingle();
  if (readErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const sessionRow = session as {
    id: string;
    status: string;
    parent_booking_id: string;
  };
  if (sessionRow.status === 'completed') {
    return NextResponse.json(
      { error: 'Completed sessions cannot be cancelled — contact us if there is a billing issue.' },
      { status: 400 },
    );
  }
  if (sessionRow.status === 'cancelled') {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // Parent ownership check
  const { data: parent } = await service
    .from('media_bookings')
    .select('user_id, band_id')
    .eq('id', sessionRow.parent_booking_id)
    .maybeSingle();
  const parentRow = parent as { user_id: string; band_id: string | null } | null;
  if (!parentRow) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  if (parentRow.user_id !== user.id) {
    if (parentRow.band_id) {
      const memberships = await getUserBands(user.id);
      const inBand = memberships.some((m) => m.band_id === parentRow.band_id);
      if (!inBand) {
        return NextResponse.json({ error: 'Not your session' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Not your session' }, { status: 403 });
    }
  }

  const { error: updateErr } = await service
    .from('media_session_bookings')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (updateErr) {
    console.error('[media/sessions/cancel] error:', updateErr);
    return NextResponse.json({ error: 'Could not cancel session' }, { status: 500 });
  }

  // If this was the last active session for the parent, demote parent
  // status from 'scheduled' back to 'deposited' so the buyer can re-schedule
  // without admin intervention. We don't touch in_production / delivered.
  const { data: remaining } = await service
    .from('media_session_bookings')
    .select('id')
    .eq('parent_booking_id', sessionRow.parent_booking_id)
    .neq('status', 'cancelled');
  if ((remaining || []).length === 0) {
    await service
      .from('media_bookings')
      .update({ status: 'deposited' })
      .eq('id', sessionRow.parent_booking_id)
      .eq('status', 'scheduled');
  }

  return NextResponse.json({ ok: true });
}
