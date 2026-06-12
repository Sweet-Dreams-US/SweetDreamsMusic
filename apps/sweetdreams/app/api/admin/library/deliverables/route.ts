import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { sendSessionFilesDelivered } from '@/lib/email';

// Allow longer timeout for large audio file uploads
export const maxDuration = 60;

// GET - fetch deliverables for a user
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  const email = url.searchParams.get('email');
  if (!userId && !email) return NextResponse.json({ error: 'user_id or email required' }, { status: 400 });

  const serviceClient = createServiceClient();

  // If email provided, look up user_id from auth users
  let resolvedUserId = userId;
  if (!resolvedUserId && email) {
    const { data: users } = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
    const user = users?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) {
      resolvedUserId = user.id;
    } else {
      return NextResponse.json({ deliverables: [] });
    }
  }

  const { data, error } = await serviceClient
    .from('deliverables')
    .select('*')
    .eq('user_id', resolvedUserId!)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deliverables: data });
}

// POST - upload a deliverable for a user
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  const serviceClient = createServiceClient();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const skipUpload = formData.get('skip_upload') === 'true';
  let userId = formData.get('user_id') as string;
  const customerEmail = formData.get('customer_email') as string;
  const displayName = formData.get('display_name') as string;
  const description = formData.get('description') as string;

  if (!file && !skipUpload) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  // If customer_email provided instead of user_id, look up the user
  if (!userId && customerEmail) {
    // Try profiles table first
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('user_id')
      .eq('email', customerEmail)
      .single();

    if (profile?.user_id) {
      userId = profile.user_id;
    } else {
      // Fallback: search auth.users via admin API
      const { data: listData } = await serviceClient.auth.admin.listUsers();
      const matchedUser = listData?.users?.find(u => u.email === customerEmail);
      if (matchedUser) {
        userId = matchedUser.id;
        // Backfill the profile email so next lookup is faster
        await serviceClient
          .from('profiles')
          .update({ email: customerEmail })
          .eq('user_id', matchedUser.id);
      }
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Could not find client account. They may need to sign up first.' }, { status: 404 });
  }

  let filePath: string;
  let fileName: string;
  let fileSize: number;
  let fileType: string;

  if (skipUpload) {
    // File was already uploaded directly to storage via signed URL
    filePath = formData.get('file_path') as string;
    fileName = formData.get('file_name') as string;
    fileSize = parseInt(formData.get('file_size') as string) || 0;
    fileType = formData.get('file_type') as string || '';
  } else {
    // Upload to Supabase Storage using service client (bypasses RLS on storage)
    const timestamp = Date.now();
    filePath = `${userId}/${timestamp}_${file!.name}`;
    fileName = file!.name;
    fileSize = file!.size;
    fileType = file!.type;

    const { error: uploadError } = await serviceClient.storage
      .from('client-audio-files')
      .upload(filePath, file!);

    if (uploadError) {
      console.error('[DELIVERABLES] Storage upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
  }

  // Get engineer's profile for the name
  const { data: engineerProfile } = await serviceClient
    .from('profiles')
    .select('display_name')
    .eq('user_id', user?.id)
    .single();

  // Create deliverable record
  const { data: deliverable, error: dbError } = await serviceClient
    .from('deliverables')
    .insert({
      user_id: userId,
      file_name: fileName,
      display_name: displayName || fileName,
      file_path: filePath,
      file_size: fileSize,
      file_type: fileType,
      uploaded_by: user?.id,
      uploaded_by_name: engineerProfile?.display_name || user?.email || 'Engineer',
      description: description || null,
    })
    .select()
    .single();

  if (dbError) {
    console.error('[DELIVERABLES] DB insert error:', dbError);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Send thank-you email if sendEmail flag is set
  const sendEmail = formData.get('send_email') as string;
  const bookingRoom = formData.get('booking_room') as string;
  const bookingDate = formData.get('booking_date') as string;
  const customerName = formData.get('customer_name') as string;
  const engineerDisplayName = engineerProfile?.display_name || user?.email || 'Your Engineer';

  if (sendEmail === 'true') {
    // Use customerEmail directly if we have it, otherwise look it up
    let clientEmail: string | undefined = customerEmail || undefined;
    if (!clientEmail) {
      const { data: clientProfile } = await serviceClient
        .from('profiles')
        .select('email')
        .eq('user_id', userId)
        .single();
      clientEmail = clientProfile?.email;

      if (!clientEmail) {
        const { data: authUser } = await serviceClient.auth.admin.getUserById(userId);
        clientEmail = authUser?.user?.email || undefined;
      }
    }

    if (clientEmail) {
      const { count } = await serviceClient
        .from('deliverables')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      await sendSessionFilesDelivered(clientEmail, {
        customerName: customerName || 'there',
        engineerName: engineerDisplayName,
        fileCount: count || 1,
        date: bookingDate || new Date().toLocaleDateString(),
        room: bookingRoom || '',
      });
    }
  }

  return NextResponse.json({ deliverable });
}

// DELETE - remove a deliverable
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const hasAccess = await verifyEngineerAccess(supabase);
  if (!hasAccess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const serviceClient = createServiceClient();

  // Get file path first
  const { data: deliverable } = await serviceClient
    .from('deliverables')
    .select('file_path')
    .eq('id', id)
    .single();

  if (deliverable?.file_path) {
    await serviceClient.storage.from('client-audio-files').remove([deliverable.file_path]);
  }

  const { error } = await serviceClient.from('deliverables').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
