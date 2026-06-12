import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// GET - public blog post listing with filters
export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);

  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const perPage = Math.min(50, Math.max(1, parseInt(searchParams.get('per_page') || '12', 10)));

  let query = supabase
    .from('blog_posts')
    .select(
      'id, slug, title, excerpt, category, featured_image_url, featured_image_alt, read_time_minutes, published_at, author_name, view_count, tags',
      { count: 'exact' }
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (category) {
    query = query.eq('category', category);
  }

  if (search) {
    const s = search.replace(/[%_\\(),]/g, '');
    if (s) {
      query = query.or(`title.ilike.%${s}%,excerpt.ilike.%${s}%,content.ilike.%${s}%`);
    }
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data: posts, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    posts: posts || [],
    pagination: {
      page,
      per_page: perPage,
      total: count || 0,
      total_pages: count ? Math.ceil(count / perPage) : 0,
    },
  });
}
