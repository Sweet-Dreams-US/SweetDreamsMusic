// GET /api/admin/media/sessions — admin oversight list of every media session
// (requests + scheduled + history), reusing the same hydrated shape the media
// team sees. Admin-only; per-id management routes already exist.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getMediaTeamJobs } from '@/lib/media-team-server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const jobs = await getMediaTeamJobs(createServiceClient(), { unclaimedOnly: false });
  return NextResponse.json({ jobs });
}
