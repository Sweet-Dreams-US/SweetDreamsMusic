import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const serviceClient = createServiceClient();

  // Get purchases by user ID first, then by email as fallback
  // Using separate queries to avoid string interpolation in .or()
  const { data: byId } = await serviceClient
    .from('beat_purchases')
    .select('*, beats(id, title, producer, genre, cover_image_url, preview_url, mp3_file_path, trackout_file_path, audio_file_path, trackout_lease_price, exclusive_price, has_exclusive, status)')
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false });

  const { data: byEmail } = await serviceClient
    .from('beat_purchases')
    .select('*, beats(id, title, producer, genre, cover_image_url, preview_url, mp3_file_path, trackout_file_path, audio_file_path, trackout_lease_price, exclusive_price, has_exclusive, status)')
    .eq('buyer_email', user.email || '')
    .order('created_at', { ascending: false });

  // Merge and deduplicate by ID
  const seen = new Set<string>();
  const purchases = [...(byId || []), ...(byEmail || [])].filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return NextResponse.json({ purchases });
}
