import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { bandSlugFromName } from '@/lib/bands';
import { uniqueBandSlug } from '@/lib/bands-server';

/**
 * POST /api/bands — create a new band with the current user as owner.
 *
 * Creates two rows in sequence: bands (row), then band_members (owner row with
 * all permissions true). If the owner row insert fails we roll back the band
 * row so we never leave an orphaned band sitting in the table.
 *
 * Gate: user must have a solo profile. Enforced in app-layer here, not RLS —
 * matches the pattern used elsewhere in the codebase.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!user.profile) {
    return NextResponse.json(
      { error: 'You need to set up your artist profile before creating a band.' },
      { status: 400 }
    );
  }

  let body: {
    display_name?: string;
    genre?: string | null;
    hometown?: string | null;
    is_public?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const name = body.display_name?.trim();
  if (!name) {
    return NextResponse.json({ error: 'Band name is required' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: 'Band name must be 80 characters or fewer' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Generate a unique slug.
  const slug = await uniqueBandSlug(bandSlugFromName(name), supabase);

  // 1. Insert the band.
  const { data: band, error: bandErr } = await supabase
    .from('bands')
    .insert({
      slug,
      display_name: name,
      genre: body.genre?.trim() || null,
      hometown: body.hometown?.trim() || null,
      is_public: body.is_public !== false,
      created_by: user.id,
    })
    .select()
    .single();

  if (bandErr || !band) {
    console.error('[bands:create] failed to create band:', bandErr);
    return NextResponse.json({ error: 'Failed to create band' }, { status: 500 });
  }

  // 2. Add the creator as owner with all permissions.
  const { error: memberErr } = await supabase.from('band_members').insert({
    band_id: band.id,
    user_id: user.id,
    role: 'owner',
    can_edit_public_page: true,
    can_book_sessions: true,
    can_book_band_sessions: true,
    can_manage_members: true,
  });

  if (memberErr) {
    // Roll back the band insert so we don't leave an orphan.
    console.error('[bands:create] failed to create owner membership, rolling back:', memberErr);
    await supabase.from('bands').delete().eq('id', band.id);
    return NextResponse.json({ error: 'Failed to create band' }, { status: 500 });
  }

  return NextResponse.json({ band });
}
