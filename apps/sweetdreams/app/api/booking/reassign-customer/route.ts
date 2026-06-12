import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

/**
 * POST /api/booking/reassign-customer — move a session to a different customer
 * account (admin OR engineer). Bookings link to a customer only by
 * `customer_email`, while files/deliverables link by account `user_id`; when a
 * customer has two accounts those can drift apart (session on one, files on the
 * other) and the engineer can't complete the session. This repoints the booking
 * (and any band-group siblings) onto the chosen account's email so the session
 * lands where the customer's files/login are.
 *
 * Body: { bookingId, targetEmail, targetName?, targetPhone?, dryRun? }.
 * dryRun:true resolves the target + returns file counts on each side WITHOUT
 * changing anything (powers the "are you moving to the right account?" preview).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveUserId(service: any, email: string): Promise<string | null> {
  const { data: prof } = await service.from('profiles').select('user_id').ilike('email', email).maybeSingle();
  if (prof?.user_id) return prof.user_id as string;
  try {
    const { data: authId } = await service.rpc('lookup_user_by_email', { lookup_email: email });
    if (authId) return authId as string;
  } catch { /* rpc may not match — fall through */ }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fileCount(service: any, userId: string | null): Promise<number> {
  if (!userId) return 0;
  const { count } = await service.from('deliverables').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return count ?? 0;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyEngineerAccess(supabase))) {
    return NextResponse.json({ error: 'Engineer or admin access required' }, { status: 401 });
  }
  const { data: { user } } = await supabase.auth.getUser();

  let body: { bookingId?: string; targetEmail?: string; targetName?: string; targetPhone?: string; dryRun?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

  const bookingId = body.bookingId;
  const targetEmail = String(body.targetEmail || '').trim().toLowerCase();
  if (!bookingId || !targetEmail) return NextResponse.json({ error: 'bookingId and targetEmail are required' }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(targetEmail)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });

  const service = createServiceClient();
  const { data: booking } = await service
    .from('bookings')
    .select('id, customer_email, customer_name, customer_phone, booking_group_id, start_time')
    .eq('id', bookingId).single();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const oldEmail = (booking.customer_email || '').toLowerCase();

  // Resolve both accounts + their file counts so the operator can confirm the
  // session is moving TO the account that holds the customer's files.
  const targetUserId = await resolveUserId(service, targetEmail);
  const oldUserId = oldEmail ? await resolveUserId(service, oldEmail) : null;
  const targetFileCount = await fileCount(service, targetUserId);
  const oldFileCount = await fileCount(service, oldUserId);

  // Pull a display name from the target account when one isn't supplied.
  let targetName = body.targetName?.trim() || undefined;
  if (!targetName && targetUserId) {
    const { data: prof } = await service.from('profiles').select('display_name').eq('user_id', targetUserId).maybeSingle();
    if (prof?.display_name) targetName = prof.display_name as string;
  }

  // Which rows move (a 3-day band block is one row per day sharing a group id).
  let ids = [bookingId];
  if (booking.booking_group_id) {
    const { data: sibs } = await service.from('bookings').select('id').eq('booking_group_id', booking.booking_group_id);
    if (sibs?.length) ids = sibs.map((s: { id: string }) => s.id);
  }

  const preview = {
    from: booking.customer_email,
    to: targetEmail,
    targetName: targetName ?? null,
    targetHasAccount: !!targetUserId,
    targetFileCount,
    oldFileCount,
    movedRows: ids.length,
  };

  if (body.dryRun) return NextResponse.json({ success: true, dryRun: true, ...preview });

  if (oldEmail === targetEmail && !body.targetName && !body.targetPhone) {
    return NextResponse.json({ error: 'This session is already on that account' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { customer_email: targetEmail, updated_at: new Date().toISOString() };
  if (targetName) updates.customer_name = targetName;
  if (body.targetPhone?.trim()) updates.customer_phone = body.targetPhone.trim();

  const { error: upErr } = await service.from('bookings').update(updates).in('id', ids);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await service.from('booking_audit_log').insert({
    booking_id: bookingId,
    action: `reassigned customer account: ${booking.customer_email || '—'} → ${targetEmail}${ids.length > 1 ? ` (${ids.length} grouped rows)` : ''}`,
    performed_by: user?.email || 'unknown',
    details: preview,
  });

  return NextResponse.json({ success: true, ...preview });
}
