import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET — fetch current user's projects
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: projects } = await supabase
    .from('profile_projects')
    .select('*')
    .eq('user_id', user.id)
    .order('display_order', { ascending: true });

  return NextResponse.json({ projects: projects || [] });
}

// POST — create a new project
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();

  const { data: project, error } = await supabase
    .from('profile_projects')
    .insert({
      user_id: user.id,
      project_name: body.project_name || 'New Project',
      project_type: body.project_type || '',
      description: body.description || '',
      link: body.link || '',
      links: body.links || {},
      cover_image_url: null,
      is_public: true,
      display_order: body.display_order || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project });
}

// PUT — update a project
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();

  const { error } = await supabase
    .from('profile_projects')
    .update({
      project_name: body.project_name,
      project_type: body.project_type,
      description: body.description,
      link: body.link,
      links: body.links || {},
      is_public: body.is_public,
      display_order: body.display_order,
    })
    .eq('id', body.id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE — delete a project
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabase
    .from('profile_projects')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
