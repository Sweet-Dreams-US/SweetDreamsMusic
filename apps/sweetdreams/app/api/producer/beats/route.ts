import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyProducerAccess } from '@/lib/admin-auth';
import { sendAdminBeatApprovalNotification } from '@/lib/email';
import { SUPER_ADMINS } from '@/lib/constants';

export async function GET() {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  // Use service client to bypass RLS — producers need to see their own beats in ALL statuses
  // (pending_approval, pending_review, active, rejected, etc.)
  const serviceClient = createServiceClient();
  const { data: beats, error } = await serviceClient
    .from('beats')
    .select('id, title, genre, bpm, musical_key, tags, mp3_lease_price, trackout_lease_price, exclusive_price, has_exclusive, lease_count, total_lease_revenue, status, created_at, preview_url, cover_image_url, mp3_file_path, trackout_file_path, audio_file_path, contains_samples, sample_details')
    .eq('producer_id', profileId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ beats: beats || [] });
}

// POST — producer creates a beat record (files already uploaded via signed URLs)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  const serviceClient = createServiceClient();
  const body = await request.json();

  const {
    title, genre, bpm, key, tags,
    mp3_lease_price, trackout_lease_price, exclusive_price,
    has_exclusive, is_lifetime_lease, contains_samples, sample_details,
    preview_file_path, mp3_file_path, trackout_file_path,
  } = body;

  if (!preview_file_path || !title) {
    return NextResponse.json({ error: 'preview_file_path and title required' }, { status: 400 });
  }

  // Convert dollar amounts to cents
  function dollarsToCents(val: string | number | null | undefined): number | null {
    if (val === null || val === undefined || val === '') return null;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return null;
    return Math.round(num * 100);
  }

  // Get producer info
  const { data: producerProfile } = await serviceClient
    .from('profiles')
    .select('display_name, producer_name')
    .eq('id', profileId)
    .single();

  const producerName = producerProfile?.producer_name || producerProfile?.display_name || 'Unknown';

  // Get public URL for the preview
  const { data: { publicUrl: previewUrl } } = serviceClient.storage
    .from('media')
    .getPublicUrl(preview_file_path);

  // Auto-generate cover art based on genre
  let coverImageUrl: string | null = null;
  try {
    const { generateBeatCover } = await import('@/lib/beat-cover');
    const svg = generateBeatCover(genre || null);
    const coverPath = `beats/covers/${Date.now()}_cover.svg`;
    const { error: coverErr } = await serviceClient.storage
      .from('media')
      .upload(coverPath, Buffer.from(svg), { contentType: 'image/svg+xml', upsert: true });
    if (!coverErr) {
      const { data: coverUrlData } = serviceClient.storage.from('media').getPublicUrl(coverPath);
      coverImageUrl = coverUrlData.publicUrl;
    }
  } catch (e) { console.error('Cover art generation error:', e); }

  // Insert beat record
  const { data: beat, error: dbError } = await serviceClient
    .from('beats')
    .insert({
      title,
      producer: producerName,
      producer_id: profileId,
      genre: genre || null,
      bpm: bpm ? parseInt(bpm) : null,
      musical_key: key || null,
      tags: tags ? (typeof tags === 'string' ? tags.split(',') : tags).map((t: string) => t.trim()).filter(Boolean).concat(['Sweet Dreams']) : ['Sweet Dreams'],
      preview_url: previewUrl,
      audio_file_path: preview_file_path,
      mp3_file_path: mp3_file_path || null,
      trackout_file_path: trackout_file_path || null,
      mp3_lease_price: dollarsToCents(mp3_lease_price),
      trackout_lease_price: dollarsToCents(trackout_lease_price),
      exclusive_price: has_exclusive ? dollarsToCents(exclusive_price) : null,
      has_exclusive: !!has_exclusive,
      is_lifetime_lease: !!is_lifetime_lease,
      contains_samples: !!contains_samples,
      sample_details: contains_samples ? sample_details || null : null,
      cover_image_url: coverImageUrl,
      status: 'pending_approval',
    })
    .select()
    .single();

  if (dbError) {
    // Clean up uploaded files since the DB insert failed
    const pathsToRemove = [preview_file_path, mp3_file_path, trackout_file_path].filter(Boolean) as string[];
    if (pathsToRemove.length > 0) {
      await serviceClient.storage.from('media').remove(pathsToRemove);
    }
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Notify admins that a new beat needs approval
  try {
    await sendAdminBeatApprovalNotification([...SUPER_ADMINS], {
      producerName,
      beatTitle: title,
      genre: genre || null,
    });
  } catch (e) {
    console.error('Failed to send admin beat approval notification:', e);
  }

  return NextResponse.json({ beat });
}

// DELETE — producer removes their own beat
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  const serviceClient = createServiceClient();
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Verify this beat belongs to this producer
  const { data: beat } = await serviceClient
    .from('beats')
    .select('audio_file_path, mp3_file_path, trackout_file_path, producer_id')
    .eq('id', id)
    .single();

  if (!beat || beat.producer_id !== profileId) {
    return NextResponse.json({ error: 'Beat not found or not yours' }, { status: 404 });
  }

  // Remove all associated files
  const filesToRemove = [beat.audio_file_path, beat.mp3_file_path, beat.trackout_file_path].filter(Boolean) as string[];
  if (filesToRemove.length > 0) {
    await serviceClient.storage.from('media').remove(filesToRemove);
  }

  const { error } = await serviceClient.from('beats').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
