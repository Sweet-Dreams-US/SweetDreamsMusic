import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';

// GET — generate a signed download URL for a deliverable
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const serviceClient = createServiceClient();

  const { data: file } = await serviceClient
    .from('deliverables')
    .select('file_path')
    .eq('id', id)
    .single();

  if (!file?.file_path) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const { data } = await serviceClient.storage
    .from('client-audio-files')
    .createSignedUrl(file.file_path, 3600, { download: true });

  if (!data?.signedUrl) {
    return NextResponse.json({ error: 'Could not generate download URL' }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
