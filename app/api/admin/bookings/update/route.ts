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

  const { error } = await supabase
    .from('bookings')
    .update({ ...updates, updated_at: new Date().toISOString() })
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
