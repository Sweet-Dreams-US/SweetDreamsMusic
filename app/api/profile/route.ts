import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET - fetch current user's profile
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, bio, profile_picture_url, cover_photo_url, social_links, public_profile_slug, career_stage, genre, is_producer')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({ profile: profile || null });
}

// PUT - update current user's profile
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { display_name, bio, social_links, career_stage, genre } = body;

  if (!display_name?.trim()) {
    return NextResponse.json({ error: 'Display name is required' }, { status: 400 });
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update({
      display_name: display_name.trim(),
      bio: bio?.trim() || null,
      social_links: social_links || {},
      career_stage: career_stage || null,
      genre: genre?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile });
}
