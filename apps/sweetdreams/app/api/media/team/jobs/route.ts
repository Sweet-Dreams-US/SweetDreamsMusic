// GET /api/media/team/jobs — the media team's full shared job queue (Phase 5).
// Team-wide: every media_manager sees every job, with the assigned manager
// shown per card. Reads via the service client after role verification.

import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { getMediaTeamJobs } from '@/lib/media-team-server';

export async function GET() {
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }
  const jobs = await getMediaTeamJobs(createServiceClient(), { unclaimedOnly: false });
  return NextResponse.json({ jobs });
}
