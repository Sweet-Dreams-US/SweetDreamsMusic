// GET /api/media/team/unclaimed — incoming media requests awaiting a media
// manager (status='requested', media_manager_id null). Shared team queue.

import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { getMediaTeamJobs } from '@/lib/media-team-server';

export async function GET() {
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }
  const jobs = await getMediaTeamJobs(createServiceClient(), { unclaimedOnly: true });
  return NextResponse.json({ jobs });
}
