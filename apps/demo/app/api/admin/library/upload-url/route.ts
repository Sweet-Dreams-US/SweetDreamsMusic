import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

// Generate a signed upload URL so the client browser can upload directly to Supabase Storage
// This bypasses Vercel's 4.5MB body size limit on serverless functions
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { fileName, userId, customerEmail } = await request.json();

  if (!fileName) {
    return NextResponse.json({ error: 'fileName required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  let resolvedUserId = userId;

  // If no userId, look up by email
  if (!resolvedUserId && customerEmail) {
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('user_id')
      .eq('email', customerEmail)
      .single();

    if (profile?.user_id) {
      resolvedUserId = profile.user_id;
    } else {
      const { data: listData } = await serviceClient.auth.admin.listUsers();
      const matchedUser = listData?.users?.find(u => u.email === customerEmail);
      if (matchedUser) {
        resolvedUserId = matchedUser.id;
        await serviceClient
          .from('profiles')
          .update({ email: customerEmail })
          .eq('user_id', matchedUser.id);
      }
    }
  }

  if (!resolvedUserId) {
    return NextResponse.json({ error: 'Could not find client account. They may need to sign up first.' }, { status: 404 });
  }

  const timestamp = Date.now();
  const filePath = `${resolvedUserId}/${timestamp}_${fileName}`;

  // Create a signed upload URL (valid for 5 minutes)
  const { data, error } = await serviceClient.storage
    .from('client-audio-files')
    .createSignedUploadUrl(filePath);

  if (error) {
    console.error('Signed URL error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    token: data.token,
    filePath,
    userId: resolvedUserId,
  });
}
