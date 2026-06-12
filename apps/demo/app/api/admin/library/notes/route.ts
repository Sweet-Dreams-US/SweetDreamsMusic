import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = new URL(request.url).searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  const { data, error } = await supabase
    .from('library_notes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  const { userId, content, category } = await request.json();

  if (!userId || !content) {
    return NextResponse.json({ error: 'userId and content required' }, { status: 400 });
  }

  const { data: engineerProfile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', user?.id)
    .single();

  const { data: note, error } = await supabase
    .from('library_notes')
    .insert({
      user_id: userId,
      admin_id: user?.id,
      admin_name: engineerProfile?.display_name || user?.email || 'Engineer',
      note_content: content,
      category: category || 'general',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase.from('library_notes').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
