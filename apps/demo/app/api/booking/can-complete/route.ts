import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { checkCanComplete } from '@/lib/booking-completion';

/**
 * GET /api/booking/can-complete?bookingId=X
 *
 * Read-only check: is this booking completable RIGHT NOW?
 * See `lib/booking-completion.ts` for the gating rules.
 *
 * Auth: engineer or admin (non-owning engineers can still inspect).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const bookingId = new URL(request.url).searchParams.get('bookingId');
  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  }

  const service = createServiceClient();
  const check = await checkCanComplete(supabase, service, bookingId);

  if (check.reasons.includes('booking_missing')) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Only expose the non-sensitive fields to the client.
  return NextResponse.json({
    canComplete: check.canComplete,
    reasons: check.reasons,
    reasonMessages: check.reasonMessages,
    details: check.details,
  });
}
