import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

/**
 * POST /api/admin/content/upload-url — signed upload URL for CMS images.
 * Mirrors /api/admin/events/cover/upload-url: the browser uploads directly to
 * Supabase Storage; we return the public URL to store in a site_content image field.
 * Body: { fileName }. Returns: { signedUrl, token, filePath, publicUrl }.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { fileName?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }
  if (!body.fileName || typeof body.fileName !== 'string') return NextResponse.json({ error: 'fileName required' }, { status: 400 });

  const ext = body.fileName.split('.').pop()?.toLowerCase() || 'jpg';
  const allowed = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
  if (!allowed.has(ext)) return NextResponse.json({ error: 'Unsupported file type. Use JPG, PNG, WebP, GIF, or AVIF.' }, { status: 400 });

  const filePath = `site-content/${user.id}-${Date.now()}.${ext}`;
  const serviceClient = createServiceClient();
  const { data: signed, error: signErr } = await serviceClient.storage.from('media').createSignedUploadUrl(filePath);
  if (signErr || !signed) {
    console.error('[admin:content:upload] signed URL error:', signErr);
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }
  const { data: pub } = serviceClient.storage.from('media').getPublicUrl(filePath);
  return NextResponse.json({ signedUrl: signed.signedUrl, token: signed.token, filePath, publicUrl: pub.publicUrl });
}
