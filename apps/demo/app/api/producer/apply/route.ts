import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Audio MIME allow-list. Covers every format musicians commonly share.
// Files whose reported `type` is blank (some browsers send '' for drag-and-drop
// uploads) fall back to an extension check.
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',        // .mp3
  'audio/mp3',         // some browsers report this
  'audio/wav',         // .wav
  'audio/x-wav',       // variant
  'audio/wave',        // variant
  'audio/aiff',        // .aiff / .aif
  'audio/x-aiff',      // variant
  'audio/flac',        // .flac
  'audio/x-flac',      // variant
  'audio/mp4',         // .m4a
  'audio/x-m4a',       // variant
  'audio/aac',         // .aac
  'audio/ogg',         // .ogg / .oga
]);
const ALLOWED_AUDIO_EXTS = /\.(mp3|wav|aiff?|flac|m4a|aac|ogg|oga)$/i;
const MAX_SAMPLE_BYTES = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const formData = await request.formData();
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const producerName = formData.get('producer_name') as string;
  const portfolioLinksRaw = formData.get('portfolio_links') as string;
  const genreSpecialties = formData.get('genre_specialties') as string;
  const reason = formData.get('reason') as string;
  const sampleBeat = formData.get('sample_beat') as File | null;

  if (!name || !email || !producerName) {
    return NextResponse.json({ error: 'name, email, and producer_name required' }, { status: 400 });
  }

  // Strict email format check — keeps junk out of the applications table.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
  }

  let portfolioLinks: string[] = [];
  try {
    portfolioLinks = portfolioLinksRaw ? JSON.parse(portfolioLinksRaw) : [];
  } catch {
    portfolioLinks = portfolioLinksRaw ? [portfolioLinksRaw] : [];
  }

  const serviceClient = createServiceClient();

  // Upload sample beat if provided — with validation. Previously this blindly
  // accepted any file of any size, which meant a malicious applicant could
  // fill our storage bucket with 500MB binaries. Now: allow-listed audio MIME
  // types (or a matching extension fallback for browsers that report no MIME),
  // and a hard 50MB cap that covers every realistic beat length.
  let sampleBeatPath: string | null = null;
  if (sampleBeat && sampleBeat.size > 0) {
    if (sampleBeat.size > MAX_SAMPLE_BYTES) {
      return NextResponse.json(
        { error: `Sample beat is too large (${Math.round(sampleBeat.size / 1024 / 1024)}MB). Maximum is 50MB.` },
        { status: 400 },
      );
    }

    const mime = (sampleBeat.type || '').toLowerCase();
    const mimeOk = mime && ALLOWED_AUDIO_MIMES.has(mime);
    const extOk = ALLOWED_AUDIO_EXTS.test(sampleBeat.name);
    if (!mimeOk && !extOk) {
      return NextResponse.json(
        { error: 'Sample beat must be an audio file (MP3, WAV, AIFF, FLAC, M4A, AAC, or OGG).' },
        { status: 400 },
      );
    }

    const timestamp = Date.now();
    // Sanitize filename — strip any path separators an attacker might inject.
    const safeName = sampleBeat.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `producer-applications/${timestamp}_${safeName}`;
    const { error: uploadError } = await serviceClient.storage
      .from('media')
      .upload(filePath, sampleBeat, {
        contentType: mime || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      // Bubble the failure so the applicant knows their beat didn't go through
      // — previously this silently swallowed the error and saved the
      // application with `sample_beat_path: null`, which looked like they
      // didn't attach anything.
      console.error('[producer:apply] upload failed:', uploadError);
      return NextResponse.json(
        { error: 'We couldn\'t upload your sample beat. Please try again or reduce the file size.' },
        { status: 500 },
      );
    }
    sampleBeatPath = filePath;
  }

  const { data, error } = await serviceClient
    .from('producer_applications')
    .insert({
      user_id: user?.id || null,
      name,
      email,
      producer_name: producerName,
      portfolio_links: portfolioLinks,
      genre_specialties: genreSpecialties ? genreSpecialties.split(',').map((s: string) => s.trim()) : [],
      sample_beat_path: sampleBeatPath,
      reason: reason || null,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ application: data });
  } catch (err) {
    console.error('Producer apply error:', err);
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
  }
}
