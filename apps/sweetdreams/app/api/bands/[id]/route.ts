import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { memberHasFlag } from '@/lib/bands';
import { getMembership } from '@/lib/bands-server';

/**
 * GET /api/bands/[id] — fetch a band with the caller's membership.
 *
 * Scoped to members only (404 if not a member, so non-members can't probe
 * for band existence). Used by the booking flow to look up band identity
 * and verify booking permission before entering band mode, but also
 * suitable as a generic "hydrate a band" endpoint for any client that
 * needs band + membership together.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bandId } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: band } = await supabase
    .from('bands')
    .select('*')
    .eq('id', bandId)
    .maybeSingle();
  if (!band) return NextResponse.json({ error: 'Band not found' }, { status: 404 });

  const membership = await getMembership(bandId, user.id);
  // Collapse "not a member" into 404 so non-members can't enumerate bands.
  if (!membership) return NextResponse.json({ error: 'Band not found' }, { status: 404 });

  return NextResponse.json({ band, membership });
}

/**
 * PATCH /api/bands/[id] — update a band's editable fields.
 *
 * Gate: caller must have `can_edit_public_page` (or be owner). The allowed
 * fields are an explicit allow-list so a stray body property can't clobber
 * things like `created_by` or `slug`.
 *
 * Slug changes are intentionally not allowed via this route — changing a slug
 * breaks every outstanding link. That will be a separate admin-only endpoint.
 */
const ALLOWED_FIELDS = new Set([
  'display_name',
  'bio',
  'genre',
  'hometown',
  'profile_picture_url',
  'cover_image_url',
  'is_public',
  'spotify_link',
  'apple_music_link',
  'instagram_link',
  'facebook_link',
  'youtube_link',
  'soundcloud_link',
  'tiktok_link',
  'twitter_link',
  'custom_links',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bandId } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const membership = await getMembership(bandId, user.id);
  if (!membership || !memberHasFlag(membership, 'can_edit_public_page')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Filter to allowed fields only.
  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(key)) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 });
  }

  // Extra validation on display_name.
  if ('display_name' in updates) {
    const name = typeof updates.display_name === 'string' ? updates.display_name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Band name cannot be empty' }, { status: 400 });
    if (name.length > 80) {
      return NextResponse.json({ error: 'Band name must be 80 characters or fewer' }, { status: 400 });
    }
    updates.display_name = name;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('bands')
    .update(updates)
    .eq('id', bandId)
    .select()
    .single();

  if (error) {
    console.error('[bands:patch] update failed:', error);
    return NextResponse.json({ error: 'Failed to update band' }, { status: 500 });
  }

  return NextResponse.json({ band: data });
}
