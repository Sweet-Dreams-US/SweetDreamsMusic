import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Look up sale by token
  const { data: sale, error: saleError } = await serviceClient
    .from('private_beat_sales')
    .select('*')
    .eq('token', token)
    .single();

  if (saleError || !sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
  }

  if (sale.status !== 'completed') {
    return NextResponse.json(
      { error: `Sale is not yet completed. Current status: ${sale.status}` },
      { status: 403 }
    );
  }

  // Look up purchase for download tracking
  if (!sale.purchase_id) {
    return NextResponse.json({ error: 'No purchase record found' }, { status: 404 });
  }

  const { data: purchase, error: purchaseError } = await serviceClient
    .from('beat_purchases')
    .select('*, beats(mp3_file_path, trackout_file_path, audio_file_path)')
    .eq('id', sale.purchase_id)
    .single();

  if (purchaseError || !purchase) {
    return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Check download limit
  if ((purchase.download_count || 0) >= 10) {
    return NextResponse.json(
      { error: 'Download limit reached (10 downloads). Contact support for assistance.' },
      { status: 403 }
    );
  }

  // Get beat file paths
  const beat = Array.isArray(purchase.beats) ? purchase.beats[0] : purchase.beats;

  // For private sales without a linked beat, files may not exist in storage
  if (!beat) {
    return NextResponse.json({
      error: 'Beat files not found. This private sale may not have files in storage yet. Contact the seller.',
    }, { status: 404 });
  }

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
    return NextResponse.json(
      { error: 'No files available for this purchase. Contact support.' },
      { status: 404 }
    );
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
    .eq('id', sale.purchase_id);

  return NextResponse.json({
    downloads: downloadLinks.filter((d) => d.url),
    downloadsRemaining: 10 - ((purchase.download_count || 0) + 1),
    licenseText: sale.agreement_text || null,
  });
}
