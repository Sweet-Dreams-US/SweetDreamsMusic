import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyAdminAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  const { applicationId, action, adminNotes } = await request.json();

  if (!applicationId || !['approved', 'denied'].includes(action)) {
    return NextResponse.json({ error: 'applicationId and action (approved/denied) required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Update application status
  const { data: application, error: appError } = await serviceClient
    .from('producer_applications')
    .update({
      status: action,
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString(),
      admin_notes: adminNotes || null,
    })
    .eq('id', applicationId)
    .select()
    .single();

  if (appError) {
    return NextResponse.json({ error: appError.message }, { status: 500 });
  }

  // If approved and user_id exists, set is_producer on their profile
  if (action === 'approved' && application.user_id) {
    const { error: profileError } = await serviceClient
      .from('profiles')
      .update({
        is_producer: true,
        producer_name: application.producer_name,
        producer_approved_at: new Date().toISOString(),
      })
      .eq('user_id', application.user_id);

    if (profileError) {
      console.error('Failed to update producer profile:', profileError);
    }
  }

  return NextResponse.json({ application });
}
