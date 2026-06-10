import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('roadmap_progress, career_stage')
    .eq('user_id', user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    progress: profile?.roadmap_progress || {},
    careerStage: profile?.career_stage || null,
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { itemId, completed } = body;

  if (!itemId || typeof completed !== 'boolean') {
    return NextResponse.json({ error: 'itemId (string) and completed (boolean) required' }, { status: 400 });
  }

  // Get current progress
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('roadmap_progress')
    .eq('user_id', user.id)
    .single();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const progress = (profile?.roadmap_progress as Record<string, boolean>) || {};

  // Only award XP when completing (not unchecking)
  const wasCompleted = progress[itemId] === true;

  // Update the progress
  if (completed) {
    progress[itemId] = true;
  } else {
    delete progress[itemId];
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ roadmap_progress: progress })
    .eq('user_id', user.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Career gates: a playbook read can complete a stage's reading requirement.
  if (completed && !wasCompleted) {
    try {
      const { createServiceClient } = await import('@/lib/supabase/server');
      const { evaluateGates } = await import('@/lib/career-rules');
      await evaluateGates(createServiceClient(), user.id);
    } catch (e) { console.error('[career] playbook hook failed:', e); }
  }

  return NextResponse.json({
    progress,
    xpEligible: completed && !wasCompleted,
  });
}
