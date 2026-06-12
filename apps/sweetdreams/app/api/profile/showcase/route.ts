import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET: fetch showcase status for user's deliverables
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: showcaseItems } = await supabase
    .from('profile_audio_showcase')
    .select('id, deliverable_id, is_public, custom_title, custom_description')
    .eq('user_id', user.id);

  return NextResponse.json({ showcaseItems: showcaseItems || [] });
}

// POST: toggle a deliverable on/off the public profile
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { deliverableId, enabled } = await req.json();
  if (!deliverableId) return NextResponse.json({ error: 'Missing deliverableId' }, { status: 400 });

  const serviceClient = createServiceClient();

  // Verify ownership
  const { data: deliverable } = await serviceClient
    .from('deliverables')
    .select('id, user_id, file_name, display_name, file_path, file_type')
    .eq('id', deliverableId)
    .single();

  if (!deliverable || deliverable.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found or not yours' }, { status: 404 });
  }

  if (enabled) {
    // Check if already exists
    const { data: existing } = await serviceClient
      .from('profile_audio_showcase')
      .select('id')
      .eq('user_id', user.id)
      .eq('deliverable_id', deliverableId)
      .single();

    if (existing) {
      // Just make it public
      await serviceClient
        .from('profile_audio_showcase')
        .update({ is_public: true })
        .eq('id', existing.id);
    } else {
      // Copy file from client-audio-files to profile-audio bucket for public access
      let profileAudioPath = deliverable.file_path;

      if (deliverable.file_path) {
        // Download from private bucket
        const { data: fileData, error: dlError } = await serviceClient.storage
          .from('client-audio-files')
          .download(deliverable.file_path);

        if (fileData && !dlError) {
          // Upload to public profile-audio bucket
          const publicPath = `${user.id}/${deliverable.file_name || deliverable.file_path.split('/').pop()}`;
          const { error: uploadError } = await serviceClient.storage
            .from('profile-audio')
            .upload(publicPath, fileData, {
              contentType: deliverable.file_type || 'audio/mpeg',
              upsert: true,
            });

          if (!uploadError) {
            profileAudioPath = publicPath;
          }
        }
      }

      // Get next display order
      const { data: maxOrder } = await serviceClient
        .from('profile_audio_showcase')
        .select('display_order')
        .eq('user_id', user.id)
        .order('display_order', { ascending: false })
        .limit(1)
        .single();

      const nextOrder = (maxOrder?.display_order || 0) + 1;

      // Create showcase entry with profile audio path
      await serviceClient
        .from('profile_audio_showcase')
        .insert({
          user_id: user.id,
          deliverable_id: deliverableId,
          custom_title: deliverable.display_name || deliverable.file_name,
          is_public: true,
          is_released: false,
          display_order: nextOrder,
          profile_audio_path: profileAudioPath,
        });
    }

    return NextResponse.json({ success: true, enabled: true });
  } else {
    // Disable: set is_public to false (keep the record so they can re-enable)
    await serviceClient
      .from('profile_audio_showcase')
      .update({ is_public: false })
      .eq('user_id', user.id)
      .eq('deliverable_id', deliverableId);

    return NextResponse.json({ success: true, enabled: false });
  }
}
