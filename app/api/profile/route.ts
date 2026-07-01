import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getUnifiedSocialLinks,
  upsertSocialLink,
  SOCIAL_PLATFORM_KEYS,
} from '@/lib/social-links-server';
import { deriveUniqueSlug } from '@/lib/profile-slug';

// GET - fetch current user's profile
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, bio, profile_picture_url, cover_photo_url, social_links, public_profile_slug, career_stage, genre, genres, is_producer')
    .eq('user_id', user.id)
    .single();

  // Unified social links (platform_connections) are the source of truth the
  // editor prefills from. Surface them as `social_links_unified` alongside the
  // legacy blob so the editor can prefer the canonical map.
  let socialLinksUnified: Record<string, string> = {};
  try {
    const unified = await getUnifiedSocialLinks(supabase, user.id);
    socialLinksUnified = unified.byPlatform;
  } catch {
    // Non-fatal — on a read error the editor just shows no prefilled links.
    // platform_connections is the single source; there is no legacy-blob fallback.
    socialLinksUnified = {};
  }

  return NextResponse.json({
    profile: profile ? { ...profile, social_links_unified: socialLinksUnified } : null,
  });
}

// PUT - update current user's profile
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { display_name, bio, social_links, genres } = body;

  if (!display_name?.trim()) {
    return NextResponse.json({ error: 'Display name is required' }, { status: 400 });
  }

  // Normalize genres to a clean string[] and mirror genres[0] to the legacy
  // single `genre` column for back-compat.
  const genresArray: string[] = Array.isArray(genres)
    ? genres.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
    : [];
  const legacyGenre = genresArray.length > 0 ? genresArray[0] : null;

  // Social links: keep writing the legacy profiles.social_links blob for
  // back-compat (the editor sends a clean {platform: url} map).
  const socialBlob: Record<string, string> =
    social_links && typeof social_links === 'object' ? social_links : {};

  // Slug is AUTO-derived from the display name — the user never picks it.
  let publicSlug: string;
  try {
    publicSlug = await deriveUniqueSlug(supabase, display_name.trim(), user.id);
  } catch {
    // If derivation fails, leave the existing slug untouched by re-reading it.
    const { data: existing } = await supabase
      .from('profiles')
      .select('public_profile_slug')
      .eq('user_id', user.id)
      .single();
    publicSlug = existing?.public_profile_slug ?? '';
  }

  // career_stage is RETIRED (computed by the career engine; the editor no
  // longer sends it). Don't touch the column here.
  const updatePayload: Record<string, unknown> = {
    display_name: display_name.trim(),
    bio: bio?.trim() || null,
    social_links: socialBlob,
    genres: genresArray,
    genre: legacyGenre,
    updated_at: new Date().toISOString(),
  };
  if (publicSlug) updatePayload.public_profile_slug = publicSlug;

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fan the entered social links into platform_connections (CANONICAL source).
  // For every known platform key: a non-empty URL upserts the connection, an
  // absent/empty one clears it. Unparseable links are skipped (non-fatal) so a
  // single bad paste never blocks the whole save.
  for (const platform of SOCIAL_PLATFORM_KEYS) {
    const url = (socialBlob[platform] ?? '').trim();
    try {
      await upsertSocialLink(supabase, user.id, platform, url);
    } catch {
      // Skip unparseable links — the legacy blob still captured the raw value.
    }
  }

  return NextResponse.json({ profile });
}
