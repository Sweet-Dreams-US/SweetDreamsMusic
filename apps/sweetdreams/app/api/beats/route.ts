import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET - public beat listing with filters
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);

  const genre = searchParams.get('genre');
  const bpmMin = searchParams.get('bpmMin');
  const bpmMax = searchParams.get('bpmMax');
  const key = searchParams.get('key');
  const producer = searchParams.get('producer');
  const search = searchParams.get('search');
  const sort = searchParams.get('sort') || 'newest';

  let query = supabase
    .from('beats')
    .select('id, title, producer, producer_id, genre, bpm, musical_key, tags, preview_url, cover_image_url, mp3_lease_price, trackout_lease_price, exclusive_price, has_exclusive, contains_samples, lease_count, status, created_at, profiles!producer_id(display_name, producer_name, public_profile_slug)')
    .eq('status', 'active');

  if (genre) query = query.eq('genre', genre);
  if (key) query = query.eq('musical_key', key);
  if (bpmMin) query = query.gte('bpm', parseInt(bpmMin));
  if (bpmMax) query = query.lte('bpm', parseInt(bpmMax));
  if (producer) query = query.eq('producer_id', producer);
  if (search) {
    const s = search.replace(/[%_\\(),]/g, '');
    if (s) query = query.or(`title.ilike.%${s}%,producer.ilike.%${s}%,genre.ilike.%${s}%`);
  }

  switch (sort) {
    case 'popular':
      query = query.order('lease_count', { ascending: false });
      break;
    case 'price_low':
      query = query.order('mp3_lease_price', { ascending: true });
      break;
    case 'price_high':
      query = query.order('mp3_lease_price', { ascending: false });
      break;
    default: // newest
      query = query.order('created_at', { ascending: false });
  }

  const { data: beats, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ beats: beats || [] });
}
