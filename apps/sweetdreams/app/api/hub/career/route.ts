// /api/hub/career — GET: the artist's full career summary (stage, gates,
// tiers). POST: re-run gate evaluation (the UI calls this after actions).

import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCareerSummary, evaluateGates } from '@/lib/career-rules';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const summary = await getCareerSummary(createServiceClient(), user.id);
  return NextResponse.json(summary);
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const db = createServiceClient();
  const result = await evaluateGates(db, user.id);
  const summary = await getCareerSummary(db, user.id);
  return NextResponse.json({ ...summary, evaluation: result });
}
