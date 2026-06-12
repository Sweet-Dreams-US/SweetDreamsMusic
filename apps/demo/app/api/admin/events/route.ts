import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { eventSlugFromTitle } from '@/lib/events';
import { uniqueEventSlug, getAllEventsForAdmin } from '@/lib/events-server';

/**
 * GET /api/admin/events — list all events for admin dashboard.
 * Returns every event (public, private_listed, private_hidden, cancelled, past).
 */
export async function GET() {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  }

  const service = createServiceClient();
  const events = await getAllEventsForAdmin(service);
  return NextResponse.json({ events });
}

/**
 * POST /api/admin/events — create a new event.
 *
 * Required: title, starts_at, visibility
 * Optional: tagline, description, cover_image_url, ends_at, location, capacity
 *
 * Slug is auto-generated from title and uniquified; admin can rename later
 * via PATCH if they want a vanity URL.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const startsAt = typeof body.starts_at === 'string' ? body.starts_at : '';
  const visibility = typeof body.visibility === 'string' ? body.visibility : 'public';

  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!startsAt) return NextResponse.json({ error: 'Start time is required' }, { status: 400 });
  if (!['public', 'private_listed', 'private_hidden'].includes(visibility)) {
    return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 });
  }
  if (Number.isNaN(new Date(startsAt).getTime())) {
    return NextResponse.json({ error: 'Invalid starts_at date' }, { status: 400 });
  }

  const service = createServiceClient();

  const baseSlug = eventSlugFromTitle(title);
  const slug = await uniqueEventSlug(baseSlug, service);

  const endsAt = typeof body.ends_at === 'string' && body.ends_at ? body.ends_at : null;
  const capacity = typeof body.capacity === 'number' && body.capacity > 0 ? body.capacity : null;

  const { data, error } = await service
    .from('events')
    .insert({
      slug,
      title,
      tagline: typeof body.tagline === 'string' ? body.tagline.trim() || null : null,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      cover_image_url: typeof body.cover_image_url === 'string' ? body.cover_image_url.trim() || null : null,
      starts_at: startsAt,
      ends_at: endsAt,
      location: typeof body.location === 'string' ? body.location.trim() || null : null,
      visibility,
      capacity,
      is_cancelled: false,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error('[admin:events:create] insert failed:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
  return NextResponse.json({ event: data });
}
