import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyProducerAccess } from '@/lib/admin-auth';

// Generate signed upload URLs so the browser can upload directly to Supabase Storage
// This bypasses Vercel's 4.5MB body size limit on serverless functions
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) {
    return NextResponse.json({ error: 'Producer access required' }, { status: 401 });
  }

  const { files } = await request.json();
  // files: Array of { type: 'preview' | 'mp3' | 'trackout', fileName: string }

  if (!files || !Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: 'files array required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const beatPrefix = `beats/${Date.now()}`;
  const results: { type: string; signedUrl: string; token: string; filePath: string }[] = [];
  const ALLOWED_TYPES = ['preview', 'mp3', 'trackout'];

  for (const file of files) {
    const { type, fileName } = file;
    if (!type || !fileName || !ALLOWED_TYPES.includes(type)) continue;

    const filePath = `${beatPrefix}/${type}_${fileName}`;

    const { data, error } = await serviceClient.storage
      .from('media')
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error(`Signed URL error for ${type}:`, error);
      return NextResponse.json({ error: `Failed to create upload URL for ${type}: ${error.message}` }, { status: 500 });
    }

    results.push({
      type,
      signedUrl: data.signedUrl,
      token: data.token,
      filePath,
    });
  }

  return NextResponse.json({ uploads: results, beatPrefix });
}
