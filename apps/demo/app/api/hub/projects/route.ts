import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_PHASE_TASKS, type ProjectPhase } from '@/lib/hub-constants';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: projects, error } = await supabase
    .from('artist_projects')
    .select('*, artist_project_tasks(id, phase, title, is_completed, display_order, completed_at)')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: projects || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { title, project_type, description, genre, target_release_date, featured_artists } = body;

  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 });

  // Create project. If a release date is set at creation, freeze the
  // days-ahead measurement NOW so the 21-day rollout item is reachable for
  // projects that never get a later PUT (review: date_ahead was dead at creation).
  const nowIso = new Date().toISOString();
  const dateAheadDays = target_release_date
    ? Math.round((Date.parse(`${String(target_release_date).slice(0, 10)}T00:00:00Z`) - Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
    : null;
  const { data: project, error } = await supabase
    .from('artist_projects')
    .insert({
      user_id: user.id,
      title: title.trim(),
      project_type: project_type || 'single',
      description: description || null,
      genre: genre || null,
      target_release_date: target_release_date || null,
      featured_artists: featured_artists || [],
      current_phase: 'concept',
      status: 'active',
      ...(target_release_date ? { release_date_set_at: nowIso, rollout_breakdown: { date_ahead_days: dateAheadDays } } : {}),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Initial rollout score (cover art / collab / etc. may already qualify).
  try {
    const { createServiceClient } = await import('@/lib/supabase/server');
    const { recomputeProjectRollout } = await import('@/lib/career-rules');
    await recomputeProjectRollout(createServiceClient(), project.id);
  } catch { /* best-effort */ }

  // Generate default tasks for all phases
  const tasks = Object.entries(DEFAULT_PHASE_TASKS).flatMap(([phase, titles]) =>
    titles.map((taskTitle, idx) => ({
      project_id: project.id,
      phase,
      title: taskTitle,
      is_default: true,
      display_order: idx,
    }))
  );

  await supabase.from('artist_project_tasks').insert(tasks);

  return NextResponse.json({ project });
}

// Editable by the artist. Engine-owned fields (rollout_score, rollout_breakdown,
// released_at, slug, release_date_set_at) are NOT in this list — the old
// blind-spread would have let a client write its own rollout score.
const EDITABLE = new Set([
  'title', 'project_type', 'description', 'genre', 'target_release_date',
  'featured_artists', 'current_phase', 'status', 'cover_image_url',
  'streaming_links', 'is_public', 'presave_url', 'video_url', 'ad_budget_cents',
]);

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { id, ...raw } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (EDITABLE.has(k)) updates[k] = v;
  updates.updated_at = new Date().toISOString();

  const { data: before } = await supabase.from('artist_projects')
    .select('current_phase,target_release_date,released_at,title,rollout_score')
    .eq('id', id).eq('user_id', user.id).single();
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Release-date set/changed: freeze the days-ahead measurement AT SET TIME
  // (moving the date later never retro-earns the 21-day rollout points).
  const dateChanged = 'target_release_date' in updates
    && updates.target_release_date !== before.target_release_date;
  if (dateChanged) updates.release_date_set_at = new Date().toISOString();

  // Releasing: stamp released_at + a public slug once, ever.
  const releasing = updates.current_phase === 'released' && before.current_phase !== 'released';
  if (releasing && !before.released_at) {
    updates.released_at = new Date().toISOString();
    updates.slug = `${String(before.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)}-${String(id).slice(0, 6)}`;
  }

  const { data: project, error } = await supabase
    .from('artist_projects')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Engine work AFTER the write (service client; never blocks the response).
  try {
    const { createServiceClient } = await import('@/lib/supabase/server');
    const db = createServiceClient();
    const { recomputeProjectRollout, evaluateGates } = await import('@/lib/career-rules');

    if (dateChanged) {
      const { data: cur } = await db.from('artist_projects').select('rollout_breakdown').eq('id', id).single();
      // Clearing the date resets the frozen measurement; setting it freezes a
      // calendar-accurate days-ahead (UTC-midnight diff, no afternoon off-by-one).
      const daysAhead = updates.target_release_date
        ? Math.round((Date.parse(`${String(updates.target_release_date).slice(0, 10)}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000)
        : null;
      await db.from('artist_projects').update({
        rollout_breakdown: { ...((cur as { rollout_breakdown?: object })?.rollout_breakdown ?? {}), date_ahead_days: daysAhead },
      } as never).eq('id', id);
    }
    const rollout = await recomputeProjectRollout(db, id);

    if (releasing) {
      const { releaseXp } = await import('@/lib/career');
      const { awardXP, XP_ACTIONS } = await import('@/lib/xp-system');
      await awardXP(db, user.id, 'release_project', {
        referenceId: `release_${id}`,
        xpOverride: releaseXp(XP_ACTIONS.release_project.xp, rollout?.score ?? before.rollout_score ?? 0),
        metadata: { project_id: id, rollout_score: rollout?.score ?? 0 },
      });
    }
    await evaluateGates(db, user.id);
  } catch (e) { console.error('[career] project hook failed:', e); }

  return NextResponse.json({ project });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase.from('artist_projects').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
