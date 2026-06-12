import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Generate a signed upload URL for profile/cover/project photos
// Browser uploads directly to Supabase Storage, bypassing Vercel's 4.5MB limit
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { fileName, type, projectId } = await request.json();
  if (!fileName) return NextResponse.json({ error: 'fileName required' }, { status: 400 });

  const serviceClient = createServiceClient();
  const ext = fileName.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  let filePath: string;

  if (type === 'cover') {
    filePath = `cover-photos/${user.id}-${timestamp}.${ext}`;
  } else if (type === 'project' && projectId) {
    filePath = `project-covers/${user.id}/${projectId}-${timestamp}.${ext}`;
  } else {
    filePath = `profile-pictures/${user.id}-${timestamp}.${ext}`;
  }

  const { data, error } = await serviceClient.storage
    .from('media')
    .createSignedUploadUrl(filePath);

  if (error) {
    console.error('Signed URL error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    token: data.token,
    filePath,
    type: type || 'profile',
    projectId: projectId || null,
  });
}
