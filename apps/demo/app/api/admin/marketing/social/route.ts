import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import {
  getIgProfile,
  getRecentIgMedia,
  getPageProfile,
  getRecentPagePosts,
} from '@/lib/meta-social';
import { PageAccessError } from '@/lib/meta-leads';

// GET /api/admin/marketing/social — the Social tab's data source.
// Instagram works today; the Facebook Page half returns { blocked } with
// setup instructions until the Page asset is assigned to the system user,
// WITHOUT failing the whole payload.

export async function GET() {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Instagram — profile reads work today; the MEDIA list (like the FB Page) is
  // served through the linked Page, so it stays gated until the Page asset is
  // assigned. Fetch independently so the profile always shows.
  let ig = null;
  let igMedia: unknown[] = [];
  let igError: string | null = null;
  try {
    ig = await getIgProfile();
  } catch (e) {
    igError = e instanceof Error ? e.message : 'Instagram unavailable';
  }
  try {
    igMedia = await getRecentIgMedia(18);
  } catch (e) {
    igError = igError ?? (e instanceof Error ? e.message : 'Instagram media unavailable');
  }

  // Facebook Page — gated until the asset is assigned.
  let page = null;
  let pagePosts: unknown[] = [];
  let pageBlocked: string | null = null;
  try {
    [page, pagePosts] = await Promise.all([getPageProfile(), getRecentPagePosts(10)]);
  } catch (e) {
    pageBlocked = e instanceof PageAccessError
      ? e.message
      : e instanceof Error ? e.message : 'Facebook Page unavailable';
  }

  return NextResponse.json({
    ig: { profile: ig, media: igMedia, error: igError },
    page: { profile: page, posts: pagePosts, blocked: pageBlocked },
  });
}
