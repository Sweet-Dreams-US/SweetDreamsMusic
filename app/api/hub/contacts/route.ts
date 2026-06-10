// /api/hub/contacts — the networking list (s3_network) + the artist's owned
// email list (listen-page feedback one-click adds land here too).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { evaluateGates } from '@/lib/career-rules';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data } = await supabase.from('artist_contacts').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  return NextResponse.json({ contacts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const { data: contact, error } = await supabase.from('artist_contacts').insert({
    user_id: user.id, name,
    handle: body.handle ? String(body.handle) : null,
    role: ['artist', 'producer', 'videographer', 'designer', 'fan', 'other'].includes(String(body.role)) ? String(body.role) : 'other',
    email: body.email ? String(body.email).toLowerCase() : null,
    met_at: body.met_at ? String(body.met_at) : null,
  } as never).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try { await evaluateGates(createServiceClient(), user.id); } catch { /* best-effort */ }
  return NextResponse.json({ contact });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('artist_contacts').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
