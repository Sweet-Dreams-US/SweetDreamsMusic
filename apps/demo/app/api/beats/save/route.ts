import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET - list saved beat IDs for current user
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ savedBeatIds: [] });

  const { data } = await supabase
    .from('user_saved_beats')
    .select('beat_id')
    .eq('user_id', user.id);

  return NextResponse.json({ savedBeatIds: data?.map((d) => d.beat_id) || [] });
}

// POST - toggle save/unsave a beat
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login required to save beats' }, { status: 401 });

  const { beatId } = await request.json();
  if (!beatId) return NextResponse.json({ error: 'beatId required' }, { status: 400 });

  // Check if already saved
  const { data: existing } = await supabase
    .from('user_saved_beats')
    .select('id')
    .eq('user_id', user.id)
    .eq('beat_id', beatId)
    .single();

  if (existing) {
    // Unsave
    await supabase.from('user_saved_beats').delete().eq('id', existing.id);
    return NextResponse.json({ saved: false });
  } else {
    // Save
    await supabase.from('user_saved_beats').insert({ user_id: user.id, beat_id: beatId });
    return NextResponse.json({ saved: true });
  }
}
