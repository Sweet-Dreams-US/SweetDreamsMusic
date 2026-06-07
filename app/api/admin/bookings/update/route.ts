import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { restoreRewardsOnCancel } from '@/lib/rewards-issue';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId, updates } = await request.json();
  if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

  const { data: { user } } = await supabase.auth.getUser();

  // Keep the invariant status='confirmed' ⇔ engineer assigned (DB CHECK, migration
  // 072). When an admin (re)assigns or clears the engineer without naming a status,
  // sync it: assigning a paid-unclaimed ('pending') session confirms it; clearing
  // the engineer on a 'confirmed' session drops it back to 'pending' (Awaiting
  // Engineer). 'completed'/'cancelled' are never auto-changed, and an explicit
  // status in the request always wins.
  const finalUpdates = { ...updates };
  if ('engineer_name' in finalUpdates && finalUpdates.status === undefined) {
    const { data: cur } = await supabase.from('bookings').select('status').eq('id', bookingId).single();
    if (finalUpdates.engineer_name && cur?.status === 'pending') finalUpdates.status = 'confirmed';
    else if (!finalUpdates.engineer_name && cur?.status === 'confirmed') finalUpdates.status = 'pending';
  }

  const { error } = await supabase
    .from('bookings')
    .update({ ...finalUpdates, updated_at: new Date().toISOString() })
    .eq('id', bookingId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log the action
  await supabase.from('booking_audit_log').insert({
    booking_id: bookingId,
    action: `updated: ${Object.keys(updates).join(', ')}`,
    performed_by: user?.email || 'unknown',
    details: updates,
  });

  // On cancel, give back any reward/credit the booking consumed (idempotent).
  if (updates?.status === 'cancelled') {
    try { await restoreRewardsOnCancel(createServiceClient(), bookingId); }
    catch (e) { console.error('[ADMIN BOOKING UPDATE] reward restore failed (non-fatal):', e); }
  }

  return NextResponse.json({ success: true });
}
