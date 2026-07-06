import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

// Toggle whether a cancelled booking's deposit was KEPT (vs refunded). Only
// deposits explicitly marked kept count toward the accounting "Kept Deposits"
// figure — keeping is now a deliberate action, not an assumption about every
// cancellation.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId, kept } = await request.json();
  if (!bookingId || typeof kept !== 'boolean') {
    return NextResponse.json({ error: 'bookingId and kept (boolean) required' }, { status: 400 });
  }

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('bookings')
    .update({
      deposit_kept: kept,
      deposit_kept_at: kept ? new Date().toISOString() : null,
      deposit_kept_by: kept ? (user?.email || 'admin') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('booking_audit_log').insert({
    booking_id: bookingId,
    action: kept ? 'deposit kept' : 'deposit kept: undone',
    performed_by: user?.email || 'unknown',
    details: { deposit_kept: kept },
  });

  return NextResponse.json({ success: true });
}
