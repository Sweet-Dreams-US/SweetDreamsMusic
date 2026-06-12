import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { sendBeatApprovedNotification, sendBeatRejectedNotification } from '@/lib/email';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 401 });

  const { beatId, action, reason } = await request.json();

  if (!beatId || !action) {
    return NextResponse.json({ error: 'beatId and action required' }, { status: 400 });
  }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Get beat details
  const { data: beat, error: beatError } = await serviceClient
    .from('beats')
    .select('id, title, producer_id, status')
    .eq('id', beatId)
    .single();

  if (beatError || !beat) {
    return NextResponse.json({ error: 'Beat not found' }, { status: 404 });
  }

  if (beat.status !== 'pending_approval') {
    return NextResponse.json({ error: 'Beat is not pending approval' }, { status: 400 });
  }

  const newStatus = action === 'approve' ? 'pending_review' : 'rejected';

  const { error: updateError } = await serviceClient
    .from('beats')
    .update({ status: newStatus })
    .eq('id', beatId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Send notification email to producer
  if (beat.producer_id) {
    try {
      const { data: producerProfile } = await serviceClient
        .from('profiles')
        .select('user_id')
        .eq('id', beat.producer_id)
        .single();

      if (producerProfile?.user_id) {
        const { data: { user: authUser } } = await serviceClient.auth.admin.getUserById(producerProfile.user_id);
        if (authUser?.email) {
          if (action === 'approve') {
            await sendBeatApprovedNotification(authUser.email, {
              beatTitle: beat.title,
            });
          } else {
            await sendBeatRejectedNotification(authUser.email, {
              beatTitle: beat.title,
              reason: reason || undefined,
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to send beat approval/rejection notification:', e);
    }
  }

  return NextResponse.json({
    success: true,
    status: newStatus,
    action,
  });
}
