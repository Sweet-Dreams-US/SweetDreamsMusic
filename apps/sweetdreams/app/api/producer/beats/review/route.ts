import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyProducerAccess } from '@/lib/admin-auth';
import { BEAT_AGREEMENT_VERSION, BEAT_AGREEMENT_TEXT, PRODUCER_COMMISSION, PLATFORM_COMMISSION } from '@/lib/constants';

// GET — fetch agreement details for a beat
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const beatId = searchParams.get('beat_id');
  if (!beatId) return NextResponse.json({ error: 'beat_id required' }, { status: 400 });

  const serviceClient = createServiceClient();

  // Fetch agreement if it exists
  const { data: agreement } = await serviceClient
    .from('beat_agreements')
    .select('*')
    .eq('beat_id', beatId)
    .eq('producer_profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    agreement: agreement || null,
    agreementVersion: BEAT_AGREEMENT_VERSION,
    agreementText: BEAT_AGREEMENT_TEXT,
  });
}

// PATCH — producer edits beat details (title, genre, bpm, key, tags) while pending
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  const serviceClient = createServiceClient();
  const body = await request.json();
  const { beat_id, title, genre, bpm, musical_key, tags } = body;

  if (!beat_id) return NextResponse.json({ error: 'beat_id required' }, { status: 400 });

  // Verify beat belongs to producer and is pending
  const { data: beat } = await serviceClient
    .from('beats')
    .select('id, producer_id, status')
    .eq('id', beat_id)
    .single();

  if (!beat) return NextResponse.json({ error: 'Beat not found' }, { status: 404 });
  if (beat.producer_id !== profileId) return NextResponse.json({ error: 'Not your beat' }, { status: 403 });
  if (beat.status !== 'pending_review') return NextResponse.json({ error: 'Can only edit beats pending review' }, { status: 400 });

  // Build update object — only allowed fields
  const updates: Record<string, unknown> = {};
  if (title !== undefined && title.trim()) updates.title = title.trim();
  if (genre !== undefined) updates.genre = genre.trim() || null;
  if (bpm !== undefined) updates.bpm = bpm ? parseInt(bpm) : null;
  if (musical_key !== undefined) updates.musical_key = musical_key.trim() || null;
  if (tags !== undefined) {
    updates.tags = typeof tags === 'string'
      ? tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : tags;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
  }

  const { data: updated, error } = await serviceClient
    .from('beats')
    .update(updates)
    .eq('id', beat_id)
    .select()
    .single();

  if (error) {
    console.error('Beat update error:', error);
    return NextResponse.json({ error: 'Failed to update beat' }, { status: 500 });
  }

  return NextResponse.json({ success: true, beat: updated });
}

// POST — producer signs agreement and beat goes active (cover auto-generated on upload)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  const serviceClient = createServiceClient();
  const body = await request.json();
  const beatId = body.beat_id;

  if (!beatId) {
    return NextResponse.json({ error: 'beat_id required' }, { status: 400 });
  }

  // Verify the beat exists, belongs to this producer, and is pending_review
  const { data: beat, error: beatError } = await serviceClient
    .from('beats')
    .select('id, title, genre, producer, producer_id, status, cover_image_url')
    .eq('id', beatId)
    .single();

  if (beatError || !beat) {
    return NextResponse.json({ error: 'Beat not found' }, { status: 404 });
  }

  if (beat.producer_id !== profileId) {
    return NextResponse.json({ error: 'This beat does not belong to you' }, { status: 403 });
  }

  if (beat.status !== 'pending_review') {
    return NextResponse.json({ error: `Beat is not pending review (current status: ${beat.status})` }, { status: 400 });
  }

  // Generate cover art if not already set
  let coverImageUrl = beat.cover_image_url;
  if (!coverImageUrl) {
    try {
      const { generateBeatCover } = await import('@/lib/beat-cover');
      const svg = generateBeatCover(beat.genre);
      const coverPath = `beats/covers/${beatId}_cover.svg`;
      const { error: coverErr } = await serviceClient.storage
        .from('media')
        .upload(coverPath, Buffer.from(svg), { contentType: 'image/svg+xml', upsert: true });
      if (!coverErr) {
        const { data: coverUrlData } = serviceClient.storage.from('media').getPublicUrl(coverPath);
        coverImageUrl = coverUrlData.publicUrl;
      }
    } catch (e) { console.error('Cover art generation error:', e); }
  }

  // Get producer name
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('display_name, producer_name')
    .eq('id', profileId)
    .single();

  const producerName = profile?.producer_name || profile?.display_name || 'Unknown';

  // Extract IP and user agent from headers
  const forwarded = request.headers.get('x-forwarded-for');
  const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  // Insert agreement record
  const { data: agreement, error: agreementError } = await serviceClient
    .from('beat_agreements')
    .insert({
      beat_id: beat.id,
      producer_profile_id: profileId,
      agreement_version: BEAT_AGREEMENT_VERSION,
      ip_address: ipAddress,
      user_agent: userAgent,
      producer_name: producerName,
      beat_title: beat.title,
      commission_rate: PRODUCER_COMMISSION,
      platform_rate: PLATFORM_COMMISSION,
      agreement_text: BEAT_AGREEMENT_TEXT,
      status: 'signed',
    })
    .select()
    .single();

  if (agreementError) {
    console.error('Agreement insert error:', agreementError);
    return NextResponse.json({ error: 'Failed to save agreement' }, { status: 500 });
  }

  // Update beat status to active (+ cover if generated)
  const updateData: Record<string, unknown> = { status: 'active' };
  if (coverImageUrl) {
    updateData.cover_image_url = coverImageUrl;
  }

  const { error: updateError } = await serviceClient
    .from('beats')
    .update(updateData)
    .eq('id', beat.id);

  if (updateError) {
    console.error('Beat status update error:', updateError);
    return NextResponse.json({ error: 'Agreement saved but failed to activate beat' }, { status: 500 });
  }

  return NextResponse.json({ success: true, agreement });
}
