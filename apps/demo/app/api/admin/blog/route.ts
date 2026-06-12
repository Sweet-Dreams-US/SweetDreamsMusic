import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

// GET - list all posts (including drafts) — admin only
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status'); // 'published', 'draft', or null for all
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const perPage = Math.min(50, Math.max(1, parseInt(searchParams.get('per_page') || '20', 10)));

  let query = serviceClient
    .from('blog_posts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
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

// POST - create new post — admin only
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const body = await request.json();

  // Generate slug from title if not provided
  if (!body.slug && body.title) {
    body.slug = body.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // Calculate read time if not provided
  if (!body.read_time_minutes && body.content) {
    const wordCount = body.content.split(/\s+/).length;
    body.read_time_minutes = Math.max(1, Math.ceil(wordCount / 200));
  }

  // Set published_at if publishing
  if (body.status === 'published' && !body.published_at) {
    body.published_at = new Date().toISOString();
  }

  const { data: post, error } = await serviceClient
    .from('blog_posts')
    .insert(body)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ post }, { status: 201 });
}

// PUT - update post — admin only
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
  }

  // Recalculate read time if content changed
  if (updates.content && !updates.read_time_minutes) {
    const wordCount = updates.content.split(/\s+/).length;
    updates.read_time_minutes = Math.max(1, Math.ceil(wordCount / 200));
  }

  // Set published_at if transitioning to published
  if (updates.status === 'published' && !updates.published_at) {
    const { data: existing } = await serviceClient
      .from('blog_posts')
      .select('published_at')
      .eq('id', id)
      .single();
    if (!existing?.published_at) {
      updates.published_at = new Date().toISOString();
    }
  }

  updates.updated_at = new Date().toISOString();

  const { data: post, error } = await serviceClient
    .from('blog_posts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ post });
}

// DELETE - delete post — admin only
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
  }

  const { error } = await serviceClient
    .from('blog_posts')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
