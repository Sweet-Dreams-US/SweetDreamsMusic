import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Upload a beat/reference file for session prep
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const bookingId = formData.get('bookingId') as string | null;

    if (!file || !bookingId) {
      return NextResponse.json({ error: 'Missing file or bookingId' }, { status: 400 });
    }

    // Validate file type (audio only)
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/m4a', 'audio/x-m4a', 'audio/mp4'];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|flac|aac|ogg|m4a)$/i)) {
      return NextResponse.json({ error: 'Only audio files are allowed (MP3, WAV, FLAC, AAC, OGG, M4A)' }, { status: 400 });
    }

    // Max 50MB
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum 50MB.' }, { status: 400 });
    }

    // Verify booking ownership
    const serviceClient = createServiceClient();
    const { data: booking } = await serviceClient
      .from('bookings')
      .select('customer_email')
      .eq('id', bookingId)
      .single();

    if (!booking || booking.customer_email !== user.email) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Upload to Supabase Storage
    const ext = file.name.split('.').pop() || 'mp3';
    const fileName = `${bookingId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await serviceClient.storage
      .from('session-prep-files')
      .upload(fileName, buffer, {
        contentType: file.type || `audio/${ext}`,
        upsert: false,
      });

    if (uploadError) {
      // If bucket doesn't exist, create it
      if (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket')) {
        await serviceClient.storage.createBucket('session-prep-files', {
          public: false,
          fileSizeLimit: 52428800, // 50MB
        });

        // Retry upload
        const { error: retryError } = await serviceClient.storage
          .from('session-prep-files')
          .upload(fileName, buffer, {
            contentType: file.type || `audio/${ext}`,
            upsert: false,
          });

        if (retryError) {
          console.error('Upload retry error:', retryError);
          return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
        }
      } else {
        console.error('Upload error:', uploadError);
        return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
      }
    }

    // Generate a signed URL for playback
    const { data: signedUrl } = await serviceClient.storage
      .from('session-prep-files')
      .createSignedUrl(fileName, 86400 * 7); // 7 days

    return NextResponse.json({
      fileUrl: fileName,
      fileName: file.name,
      signedUrl: signedUrl?.signedUrl,
    });
  } catch (error) {
    console.error('Prep upload error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
