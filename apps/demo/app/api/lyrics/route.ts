import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET - fetch lyrics for a user+beat pair
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ lyrics: null });

  const { searchParams } = new URL(request.url);
  const beatId = searchParams.get('beatId');
  if (!beatId) return NextResponse.json({ error: 'beatId required' }, { status: 400 });

  const { data } = await supabase
    .from('user_lyrics')
    .select('id, sections, updated_at')
    .eq('user_id', user.id)
    .eq('beat_id', beatId)
    .single();

  return NextResponse.json({ lyrics: data });
}

// POST - upsert lyrics for a user+beat pair
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login required to save lyrics' }, { status: 401 });

  const { beatId, sections } = await request.json();
  if (!beatId) return NextResponse.json({ error: 'beatId required' }, { status: 400 });

  // Check if lyrics already exist
  const { data: existing } = await supabase
    .from('user_lyrics')
    .select('id')
    .eq('user_id', user.id)
    .eq('beat_id', beatId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('user_lyrics')
      .update({ sections, updated_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('user_lyrics')
      .insert({ user_id: user.id, beat_id: beatId, sections });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}
