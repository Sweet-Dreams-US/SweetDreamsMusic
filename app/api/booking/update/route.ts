import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { bookingId, status, startTime, duration, notes, engineerName, customerName, customerEmail, artistName, room } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  // Build update object — engineers can update status, time, duration, notes, engineer, and client info
  const updates: Record<string, unknown> = {};

  if (status && ['completed', 'cancelled'].includes(status)) {
    updates.status = status;
  }

  if (startTime) {
    updates.start_time = startTime;
  }

  if (duration !== undefined && duration > 0) {
    updates.duration = duration;
  }

  // When start_time or duration changes, end_time must follow. Otherwise the
  // completion gate (lib/booking-completion.ts) and downstream calendar math
  // read the wrong end. We fetch the current row only when needed, so the
  // common "just update notes" path stays a single write.
  if (updates.start_time !== undefined || updates.duration !== undefined) {
    const { data: current } = await supabase
      .from('bookings')
      .select('start_time, duration')
      .eq('id', bookingId)
      .maybeSingle();
    const effectiveStart = (updates.start_time as string) ?? current?.start_time;
    const effectiveDuration = (updates.duration as number) ?? Number(current?.duration);
    if (effectiveStart && Number.isFinite(effectiveDuration) && effectiveDuration > 0) {
      const startMs = new Date(effectiveStart).getTime();
      const endIso = new Date(startMs + effectiveDuration * 3_600_000).toISOString();
      updates.end_time = endIso;
    }
  }

  if (notes !== undefined) {
    updates.admin_notes = notes;
  }

  // Allow changing engineer assignment
  if (engineerName !== undefined) {
    updates.engineer_name = engineerName || null;
    if (engineerName) {
      updates.claimed_at = new Date().toISOString();
    }
  }

  // Allow updating client info
  if (customerName !== undefined) {
    updates.customer_name = customerName;
  }
  if (customerEmail !== undefined) {
    updates.customer_email = customerEmail;
  }
  if (artistName !== undefined) {
    updates.artist_name = artistName;
  }
  if (room !== undefined) {
    updates.room = room;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
  }

  const { error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', bookingId);

  if (error) {
    console.error('[BOOKING UPDATE] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
