// POST /api/hub/career/confirm — complete an honor-system requirement with
// structured answers. Light XP by design: lying about an open mic earns 10 XP
// and moves nothing that matters; verified gates carry the weight.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { evaluateGates } from '@/lib/career-rules';
import { awardXP } from '@/lib/xp-system';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { key?: string; answers?: Record<string, string | number> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const key = String(body.key || '');
  const answers = body.answers ?? {};

  const db = createServiceClient();
  const { data: req } = await db.from('career_stage_requirements')
    .select('*').eq('key', key).eq('active', true).maybeSingle();
  if (!req) return NextResponse.json({ error: 'Unknown requirement' }, { status: 404 });
  const reqRow = req as { verify_type: string; confirm_fields: { key: string; label: string }[] | null; xp_award: number };
  if (reqRow.verify_type !== 'confirm') {
    return NextResponse.json({ error: 'This requirement is verified automatically — it completes on its own when the work is real.' }, { status: 400 });
  }
  // Confirm-type with a machine rule (e.g. log-3-contacts) completes via evaluation, not this form.
  if (!reqRow.confirm_fields || reqRow.confirm_fields.length === 0) {
    return NextResponse.json({ error: 'This one completes from your logged data.' }, { status: 400 });
  }
  for (const f of reqRow.confirm_fields) {
    if (answers[f.key] == null || String(answers[f.key]).trim() === '') {
      return NextResponse.json({ error: `Missing: ${f.label}` }, { status: 400 });
    }
  }

  const { data: existing } = await db.from('requirement_progress')
    .select('status').eq('user_id', user.id).eq('requirement_key', key).maybeSingle();
  if ((existing as { status?: string })?.status === 'complete') {
    return NextResponse.json({ success: true, alreadyComplete: true });
  }

  const { error } = await db.from('requirement_progress').upsert({
    user_id: user.id, requirement_key: key, status: 'complete',
    completed_at: new Date().toISOString(),
    evidence: { answers, confirmed_via: 'honor' },
  } as never, { onConflict: 'user_id,requirement_key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await awardXP(db, user.id, 'career_requirement', {
    referenceId: `req_${key}`, xpOverride: reqRow.xp_award,
    metadata: { requirement: key, verify_type: 'confirm' },
  });

  // Stage may have just completed.
  const result = await evaluateGates(db, user.id);
  return NextResponse.json({ success: true, stage: result.stage, stageUp: result.stageUp });
}
