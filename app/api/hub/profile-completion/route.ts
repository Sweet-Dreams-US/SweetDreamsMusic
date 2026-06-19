// GET /api/hub/profile-completion — the signed-in user's profile-completion
// state for the Hub "Complete your profile" workflow.
//
// Single source of truth: this route assembles the inputs (profile row +
// unified social-link count) and hands them to computeProfileCompletion() in
// lib/profile-completion.ts, then returns its result verbatim. The client
// (components/hub/ProfileCompletion.tsx) only renders — it never re-derives
// what "complete" means, so the checklist a user sees and the reward gate that
// fires on completion can never disagree.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUnifiedSocialLinks } from '@/lib/social-links-server';
import { computeProfileCompletion } from '@/lib/profile-completion';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Profile row (display name, photos, bio, genres) + unified social-link count.
  const [profileRes, socialLinks] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, profile_picture_url, cover_photo_url, bio, genres')
      .eq('user_id', user.id)
      .maybeSingle(),
    getUnifiedSocialLinks(supabase, user.id),
  ]);

  const profile = profileRes.data ?? null;

  const result = computeProfileCompletion({
    display_name: profile?.display_name ?? null,
    profile_picture_url: profile?.profile_picture_url ?? null,
    cover_photo_url: profile?.cover_photo_url ?? null,
    bio: profile?.bio ?? null,
    genres: (profile?.genres as string[] | null) ?? null,
    socialLinkCount: socialLinks.count,
  });

  return NextResponse.json(result);
}
