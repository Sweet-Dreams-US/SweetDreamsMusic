import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const serviceClient = createServiceClient();
  const contentType = request.headers.get('content-type') || '';

  // JSON body = file already uploaded via signed URL, just save the record
  if (contentType.includes('application/json')) {
    const { filePath, type, projectId } = await request.json();
    if (!filePath) return NextResponse.json({ error: 'filePath required' }, { status: 400 });

    const { data: { publicUrl } } = serviceClient.storage
      .from('media')
      .getPublicUrl(filePath);

    if (type === 'cover') {
      await serviceClient.from('profiles')
        .update({ cover_photo_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    } else if (type === 'project' && projectId) {
      await serviceClient.from('profile_projects')
        .update({ cover_image_url: publicUrl })
        .eq('id', projectId).eq('user_id', user.id);
    } else {
      await serviceClient.from('profiles')
        .update({ profile_picture_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    return NextResponse.json({ url: publicUrl });
  }

  // FormData body = legacy upload through API (small files still work)
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const type = (formData.get('type') as string) || 'profile';
  const projectId = formData.get('projectId') as string | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File must be under 5MB' }, { status: 400 });
  }

  const ext = file.name.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  let filePath: string;

  if (type === 'cover') {
    filePath = `cover-photos/${user.id}-${timestamp}.${ext}`;
  } else if (type === 'project' && projectId) {
    filePath = `project-covers/${user.id}/${projectId}-${timestamp}.${ext}`;
  } else {
    filePath = `profile-pictures/${user.id}-${timestamp}.${ext}`;
  }

  const { error: uploadError } = await serviceClient.storage
    .from('media')
    .upload(filePath, file, { upsert: true });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: { publicUrl } } = serviceClient.storage
    .from('media')
    .getPublicUrl(filePath);

  if (type === 'cover') {
    await serviceClient.from('profiles')
      .update({ cover_photo_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
  } else if (type === 'project' && projectId) {
    await serviceClient.from('profile_projects')
      .update({ cover_image_url: publicUrl })
      .eq('id', projectId).eq('user_id', user.id);
  } else {
    await serviceClient.from('profiles')
      .update({ profile_picture_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
  }

  return NextResponse.json({ url: publicUrl });
}
