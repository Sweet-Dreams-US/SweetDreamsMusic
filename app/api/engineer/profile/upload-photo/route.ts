import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

/**
 * POST /api/engineer/profile/upload-photo — signed upload URL for the engineer's
 * OWN profile photo. Mirrors /api/admin/engineers/upload-url EXACTLY (same `media`
 * bucket, same `engineers/` folder, same extension validation, same getPublicUrl);
 * the ONLY difference is the guard — verifyEngineerAccess instead of admin. The
 * browser uploads the file directly to Supabase Storage and we return the public
 * URL to store in engineers.photo_url. Body: { fileName }. Returns { signedUrl, publicUrl }.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyEngineerAccess(supabase))) return NextResponse.json({ error: 'Engineers only' }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { fileName?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }
  if (!body.fileName || typeof body.fileName !== 'string') return NextResponse.json({ error: 'fileName required' }, { status: 400 });

  const ext = body.fileName.split('.').pop()?.toLowerCase() || 'jpg';
  const allowed = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
  if (!allowed.has(ext)) return NextResponse.json({ error: 'Unsupported file type. Use JPG, PNG, WebP, GIF, or AVIF.' }, { status: 400 });

  const filePath = `engineers/${user.id}-${Date.now()}.${ext}`;
  const serviceClient = createServiceClient();
  const { data: signed, error: signErr } = await serviceClient.storage.from('media').createSignedUploadUrl(filePath);
  if (signErr || !signed) {
    console.error('[engineer:profile:upload] signed URL error:', signErr);
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }
  const { data: pub } = serviceClient.storage.from('media').getPublicUrl(filePath);
  return NextResponse.json({ signedUrl: signed.signedUrl, publicUrl: pub.publicUrl });
}
