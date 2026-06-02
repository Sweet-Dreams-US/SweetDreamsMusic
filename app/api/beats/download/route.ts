import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fmtStampDate } from '@/lib/studio-time';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const purchaseId = searchParams.get('purchaseId');
  if (!purchaseId) return NextResponse.json({ error: 'purchaseId required' }, { status: 400 });

  const serviceClient = createServiceClient();

  // Verify purchase ownership
  const { data: purchase, error } = await serviceClient
    .from('beat_purchases')
    .select('*, beats(mp3_file_path, trackout_file_path, audio_file_path)')
    .eq('id', purchaseId)
    .single();

  if (error || !purchase) {
    return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
  }

  if (purchase.buyer_id !== user.id && purchase.buyer_email !== user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Check if lease has been revoked (immediate revocation — legacy)
  if (purchase.revoked_at) {
    return NextResponse.json({
      error: 'This lease has been revoked because exclusive rights to this beat were purchased. Your lease agreement is no longer valid.',
      revoked: true,
      revoked_at: purchase.revoked_at,
    }, { status: 403 });
  }

  // Check if lease has expired
  if (purchase.lease_expires_at && new Date(purchase.lease_expires_at) < new Date()) {
    return NextResponse.json({
      error: `Your lease expired on ${fmtStampDate(purchase.lease_expires_at, { month: 'long' })}. Renew your license to continue downloading.`,
      expired: true,
      lease_expires_at: purchase.lease_expires_at,
    }, { status: 403 });
  }

  // Check download limit
  if (purchase.download_count >= 10) {
    return NextResponse.json({ error: 'Download limit reached (10 downloads). Contact support for assistance.' }, { status: 403 });
  }

  const beat = Array.isArray(purchase.beats) ? purchase.beats[0] : purchase.beats;
  if (!beat) return NextResponse.json({ error: 'Beat files not found' }, { status: 404 });

  // Determine which files to deliver based on license type
  const filePaths: string[] = [];
  switch (purchase.license_type) {
    case 'mp3_lease':
      if (beat.mp3_file_path) filePaths.push(beat.mp3_file_path);
      break;
    case 'trackout_lease':
      if (beat.trackout_file_path) filePaths.push(beat.trackout_file_path);
      if (beat.mp3_file_path) filePaths.push(beat.mp3_file_path);
      break;
    case 'exclusive':
      if (beat.mp3_file_path) filePaths.push(beat.mp3_file_path);
      if (beat.trackout_file_path) filePaths.push(beat.trackout_file_path);
      if (beat.audio_file_path) filePaths.push(beat.audio_file_path);
      break;
  }

  if (filePaths.length === 0) {
    return NextResponse.json({ error: 'No files available for this purchase. Contact support.' }, { status: 404 });
  }

  // Generate signed URLs (1 hour expiry)
  const downloadLinks = await Promise.all(
    filePaths.map(async (path) => {
      const { data } = await serviceClient.storage.from('media').createSignedUrl(path, 3600);
      const fileName = path.split('/').pop() || 'file';
      return { url: data?.signedUrl || null, fileName };
    })
  );

  // Increment download count
  await serviceClient
    .from('beat_purchases')
    .update({ download_count: (purchase.download_count || 0) + 1 })
    .eq('id', purchaseId);

  return NextResponse.json({
    downloads: downloadLinks.filter((d) => d.url),
    downloadsRemaining: 10 - (purchase.download_count + 1),
  });
}
