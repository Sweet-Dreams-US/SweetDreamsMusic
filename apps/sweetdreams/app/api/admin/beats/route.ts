import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { sendBeatReviewNotification } from '@/lib/email';

// GET - list all beats with producer info (admin sees ALL statuses including pending_approval)
export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  // Use service client to bypass RLS (which only shows status='active' to regular users)
  const serviceClient = createServiceClient();

  const { data: beats, error } = await serviceClient
    .from('beats')
    .select('*, producer_profile:profiles!producer_id(display_name, producer_name)')
    .order('created_at', { ascending: false });

  if (error) {
    // Fallback without join if producer_id column doesn't exist yet
    const { data: fallbackBeats, error: fallbackError } = await serviceClient
      .from('beats')
      .select('*')
      .order('created_at', { ascending: false });

    if (fallbackError) return NextResponse.json({ error: fallbackError.message }, { status: 500 });
    return NextResponse.json({ beats: fallbackBeats || [] });
  }

  return NextResponse.json({ beats: beats || [] });
}

// POST - admin creates a new beat listing
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  const serviceClient = createServiceClient();
  const formData = await request.formData();

  const previewFile = formData.get('preview_file') as File;
  const title = formData.get('title') as string;
  const producerId = formData.get('producer_id') as string;
  const genre = formData.get('genre') as string;
  const bpm = formData.get('bpm') as string;
  const key = formData.get('key') as string;
  const tags = formData.get('tags') as string;
  const mp3LeasePriceRaw = formData.get('mp3_lease_price') as string;
  const trackoutLeasePriceRaw = formData.get('trackout_lease_price') as string;
  const exclusivePriceRaw = formData.get('exclusive_price') as string;

  // Convert dollar amounts to cents (e.g., "29.99" → 2999)
  function dollarsToCents(val: string): number | null {
    if (!val) return null;
    const num = parseFloat(val);
    if (isNaN(num)) return null;
    return Math.round(num * 100);
  }
  const mp3LeasePrice = dollarsToCents(mp3LeasePriceRaw);
  const trackoutLeasePrice = dollarsToCents(trackoutLeasePriceRaw);
  const exclusivePriceCents = dollarsToCents(exclusivePriceRaw);
  const hasExclusive = formData.get('has_exclusive') === 'true';
  const containsSamples = formData.get('contains_samples') === 'true';
  const sampleDetails = formData.get('sample_details') as string;
  const mp3File = formData.get('mp3_file') as File | null;
  const trackoutFile = formData.get('trackout_file') as File | null;

  if (!previewFile || !title || !producerId) {
    return NextResponse.json({ error: 'preview_file, title, and producer_id required' }, { status: 400 });
  }

  // Get producer info for the text producer field (backward compat)
  const { data: producerProfile } = await serviceClient
    .from('profiles')
    .select('display_name, producer_name')
    .eq('id', producerId)
    .single();

  const producerName = producerProfile?.producer_name || producerProfile?.display_name || 'Unknown';

  // Generate a beat ID prefix for organizing files
  const beatPrefix = `beats/${Date.now()}`;

  // Upload preview audio
  const previewPath = `${beatPrefix}/preview_${previewFile.name}`;
  const { error: previewUploadError } = await serviceClient.storage
    .from('media')
    .upload(previewPath, previewFile);

  if (previewUploadError) {
    return NextResponse.json({ error: `Preview upload failed: ${previewUploadError.message}` }, { status: 500 });
  }

  const { data: { publicUrl: previewUrl } } = serviceClient.storage
    .from('media')
    .getPublicUrl(previewPath);

  // Upload MP3 master if provided
  let mp3FilePath: string | null = null;
  if (mp3File && mp3File.size > 0) {
    mp3FilePath = `${beatPrefix}/mp3_${mp3File.name}`;
    const { error: mp3Error } = await serviceClient.storage.from('media').upload(mp3FilePath, mp3File);
    if (mp3Error) {
      console.error('MP3 upload failed:', mp3Error);
      mp3FilePath = null;
    }
  }

  // Upload trackout/stems ZIP if provided
  let trackoutFilePath: string | null = null;
  if (trackoutFile && trackoutFile.size > 0) {
    trackoutFilePath = `${beatPrefix}/trackout_${trackoutFile.name}`;
    const { error: trackoutError } = await serviceClient.storage.from('media').upload(trackoutFilePath, trackoutFile);
    if (trackoutError) {
      console.error('Trackout upload failed:', trackoutError);
      trackoutFilePath = null;
    }
  }

  // Auto-generate cover art SVG and upload
  let coverImageUrl: string | null = null;
  let coverImagePath: string | null = null;
  if (genre) {
    try {
      const { BEAT_GENRES } = await import('@/lib/constants');
      const genreConfig = BEAT_GENRES.find((g: { value: string }) => g.value === genre);
      const bg = genreConfig?.bg || '#1a1a1a';
      const textColor = genreConfig?.text || '#e6c94a';

      function adjustColor(hex: string, amount: number): string {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + amount));
        const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount));
        const b = Math.max(0, Math.min(255, (num & 0xFF) + amount));
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
      }
      function escapeXml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      }
      const fontSize = title.length <= 10 ? 56 : title.length <= 18 ? 44 : title.length <= 28 ? 36 : 28;

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
        <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${bg}" /><stop offset="100%" style="stop-color:${adjustColor(bg, -30)}" /></linearGradient></defs>
        <rect width="800" height="800" fill="url(#bg)" />
        <line x1="0" y1="600" x2="800" y2="600" stroke="${textColor}" stroke-opacity="0.08" stroke-width="1" />
        <line x1="0" y1="200" x2="800" y2="200" stroke="${textColor}" stroke-opacity="0.08" stroke-width="1" />
        <rect x="60" y="580" width="120" height="4" fill="${textColor}" opacity="0.7" />
        <text x="60" y="660" font-family="Impact,'Arial Black',sans-serif" font-size="72" font-weight="900" letter-spacing="4" fill="${textColor}" opacity="0.9">SWEET</text>
        <text x="60" y="740" font-family="Impact,'Arial Black',sans-serif" font-size="72" font-weight="900" letter-spacing="4" fill="${textColor}" opacity="0.9">DREAMS</text>
        <text x="60" y="540" font-family="'Helvetica Neue',sans-serif" font-size="${fontSize}" font-weight="700" fill="white" opacity="0.95">${escapeXml(title)}</text>
        <text x="60" y="120" font-family="monospace" font-size="18" font-weight="600" fill="${textColor}" opacity="0.5" letter-spacing="6">${escapeXml(genre.toUpperCase())}</text>
        <rect x="740" y="40" width="24" height="24" fill="${textColor}" opacity="0.15" />
      </svg>`;

      coverImagePath = `${beatPrefix}/cover.svg`;
      const { error: coverUploadErr } = await serviceClient.storage
        .from('media')
        .upload(coverImagePath, Buffer.from(svg), { contentType: 'image/svg+xml', upsert: true });

      if (!coverUploadErr) {
        const { data: coverUrlData } = serviceClient.storage.from('media').getPublicUrl(coverImagePath);
        coverImageUrl = coverUrlData.publicUrl;
      } else {
        console.error('Cover art upload error:', coverUploadErr);
      }
    } catch (e) {
      console.error('Cover art generation error:', e);
    }
  }

  // Insert beat record
  const { data: beat, error: dbError } = await serviceClient
    .from('beats')
    .insert({
      title,
      producer: producerName,
      producer_id: producerId,
      genre: genre || null,
      bpm: bpm ? parseInt(bpm) : null,
      musical_key: key || null,
      tags: tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean).concat(['Sweet Dreams']) : ['Sweet Dreams'],
      preview_url: previewUrl,
      audio_file_path: previewPath,
      mp3_file_path: mp3FilePath,
      trackout_file_path: trackoutFilePath,
      mp3_lease_price: mp3LeasePrice,
      trackout_lease_price: trackoutLeasePrice,
      exclusive_price: hasExclusive ? exclusivePriceCents : null,
      has_exclusive: hasExclusive,
      contains_samples: containsSamples,
      sample_details: containsSamples ? sampleDetails || null : null,
      cover_image_url: coverImageUrl,
      cover_image_path: coverImagePath,
      status: 'pending_review',
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // Send review notification email to producer
  try {
    const { data: producerUser } = await serviceClient
      .from('profiles')
      .select('user_id')
      .eq('id', producerId)
      .single();

    if (producerUser?.user_id) {
      const { data: { user: authUser } } = await serviceClient.auth.admin.getUserById(producerUser.user_id);
      if (authUser?.email) {
        await sendBeatReviewNotification(authUser.email, {
          producerName,
          beatTitle: title,
        });
      }
    }
  } catch (e) {
    console.error('Failed to send beat review notification:', e);
  }

  return NextResponse.json({ beat });
}

// DELETE - admin removes a beat
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  const serviceClient = createServiceClient();
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Get all file paths
  const { data: beat } = await serviceClient
    .from('beats')
    .select('audio_file_path, mp3_file_path, trackout_file_path')
    .eq('id', id)
    .single();

  // Remove all associated files
  if (beat) {
    const filesToRemove = [beat.audio_file_path, beat.mp3_file_path, beat.trackout_file_path].filter(Boolean) as string[];
    if (filesToRemove.length > 0) {
      await serviceClient.storage.from('media').remove(filesToRemove);
    }
  }

  const { error } = await serviceClient.from('beats').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
