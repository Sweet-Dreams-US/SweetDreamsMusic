import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { memberHasFlag } from '@/lib/bands';
import { getMembership } from '@/lib/bands-server';

/**
 * POST /api/bands/[id]/photo/upload-url — signed upload URL for band images.
 *
 * Matches the solo-profile photo upload pattern: the browser uploads directly
 * to Supabase Storage via the signed URL (bypassing Vercel's 4.5MB function
 * body limit), then PATCHes the band record with the resulting publicUrl.
 *
 * Body: { fileName: string; type: 'profile' | 'cover' }
 *
 * Gate: caller must have `can_edit_public_page` for the band.
 */
export async function POST(
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

  let body: { fileName?: string; type?: 'profile' | 'cover' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!body.fileName) {
    return NextResponse.json({ error: 'fileName required' }, { status: 400 });
  }
  const type = body.type === 'cover' ? 'cover' : 'profile';

  const ext = body.fileName.split('.').pop()?.toLowerCase() || 'jpg';
  const timestamp = Date.now();
  const folder = type === 'cover' ? 'band-covers' : 'band-profiles';
  const filePath = `${folder}/${bandId}-${timestamp}.${ext}`;

  const serviceClient = createServiceClient();
  const { data: signed, error: signErr } = await serviceClient.storage
    .from('media')
    .createSignedUploadUrl(filePath);

  if (signErr || !signed) {
    console.error('[bands:photo] signed URL error:', signErr);
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }

  // Pre-compute the public URL — once the upload lands at this path, this URL
  // will serve it. Returning it saves the client a second round-trip.
  const { data: pub } = serviceClient.storage.from('media').getPublicUrl(filePath);

  return NextResponse.json({
    signedUrl: signed.signedUrl,
    token: signed.token,
    filePath,
    publicUrl: pub.publicUrl,
    type,
  });
}
