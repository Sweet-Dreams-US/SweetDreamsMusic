import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

/**
 * POST /api/admin/events/cover/upload-url — signed upload URL for event flyers.
 *
 * Mirrors `/api/bands/[id]/photo/upload-url`: the browser uploads directly to
 * Supabase Storage via a one-time signed URL. This bypasses Vercel's 4.5 MB
 * function body limit, which matters because flyers are often higher-res than
 * the 4.5 MB cap allows.
 *
 * Why timestamp+userId in the path (not eventId): the admin form supports
 * uploading a flyer BEFORE the event row exists (during the create flow).
 * We don't have a stable event id yet, so we key by uploader. Once the form
 * saves, the resulting publicUrl is written to events.cover_image_url.
 *
 * Body: { fileName: string }
 * Returns: { signedUrl, publicUrl, filePath }
 *
 * Auth: admin only — anyone with admin access in the dashboard can upload.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { fileName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!body.fileName || typeof body.fileName !== 'string') {
    return NextResponse.json({ error: 'fileName required' }, { status: 400 });
  }

  // Allow common image extensions only — keeps the bucket sane and stops
  // someone uploading e.g. a .html file that the storage URL would happily
  // serve as text/html.
  const ext = body.fileName.split('.').pop()?.toLowerCase() || 'jpg';
  const allowed = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
  if (!allowed.has(ext)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Use JPG, PNG, WebP, GIF, or AVIF.' },
      { status: 400 },
    );
  }

  const timestamp = Date.now();
  const filePath = `event-covers/${user.id}-${timestamp}.${ext}`;

  const serviceClient = createServiceClient();
  const { data: signed, error: signErr } = await serviceClient.storage
    .from('media')
    .createSignedUploadUrl(filePath);

  if (signErr || !signed) {
    console.error('[admin:events:cover] signed URL error:', signErr);
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }

  // Pre-compute the public URL so the client doesn't need a second round-trip
  // after the upload lands.
  const { data: pub } = serviceClient.storage.from('media').getPublicUrl(filePath);

  return NextResponse.json({
    signedUrl: signed.signedUrl,
    token: signed.token,
    filePath,
    publicUrl: pub.publicUrl,
  });
}
