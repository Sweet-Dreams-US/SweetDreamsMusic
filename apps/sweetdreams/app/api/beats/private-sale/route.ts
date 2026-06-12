import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess, verifyProducerAccess } from '@/lib/admin-auth';
import { sendPrivateBeatSaleInvite } from '@/lib/email';
import { BEAT_LICENSES, type BeatLicenseType } from '@/lib/constants';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const serviceClient = createServiceClient();

  // Verify admin or producer
  const isAdmin = await verifyAdminAccess(supabase);
  const { isProducer, profileId } = await verifyProducerAccess(supabase);

  if (!isAdmin && !isProducer) {
    return NextResponse.json({ error: 'Unauthorized — admin or producer access required' }, { status: 401 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    // Handle both JSON and FormData (for file uploads)
    const contentType = request.headers.get('content-type') || '';
    let beatId: string | null = null;
    let buyerName = '';
    let buyerEmail = '';
    let licenseType = '';
    let amount = 0;
    let paymentMethod = 'stripe';
    let requiresPayment: boolean | string = true;
    let notes: string | null = null;
    let providedTitle = '';
    let providedProducer = '';
    let producerId: string | null = null;
    let beatFile: File | null = null;
    let stemsFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      beatId = formData.get('beatId') as string || null;
      buyerName = formData.get('buyerName') as string || '';
      buyerEmail = formData.get('buyerEmail') as string || '';
      licenseType = formData.get('licenseType') as string || '';
      amount = parseFloat(formData.get('amount') as string || '0');
      paymentMethod = formData.get('paymentMethod') as string || 'stripe';
      requiresPayment = formData.get('requiresPayment') as string;
      notes = formData.get('notes') as string || null;
      providedTitle = formData.get('beatTitle') as string || '';
      providedProducer = formData.get('beatProducer') as string || '';
      producerId = formData.get('producerId') as string || null;
      beatFile = formData.get('beat_file') as File | null;
      stemsFile = formData.get('stems_file') as File | null;
    } else {
      const body = await request.json();
      beatId = body.beatId || null;
      buyerName = body.buyerName || '';
      buyerEmail = body.buyerEmail || '';
      licenseType = body.licenseType || '';
      amount = body.amount || 0;
      paymentMethod = body.paymentMethod || 'stripe';
      requiresPayment = body.requiresPayment;
      notes = body.notes || null;
      providedTitle = body.beatTitle || '';
      providedProducer = body.beatProducer || '';
      producerId = body.producerId || null;
    }

    const reqPayment = requiresPayment !== false && requiresPayment !== 'false';

    if (!buyerName || !buyerEmail || !licenseType) {
      return NextResponse.json({ error: 'buyerName, buyerEmail, and licenseType are required' }, { status: 400 });
    }

    if (!(licenseType in BEAT_LICENSES)) {
      return NextResponse.json({ error: 'Invalid license type' }, { status: 400 });
    }

    // Convert dollars to cents
    const amountCents = Math.round((amount || 0) * 100);

    let beatTitle = providedTitle || '';
    let beatProducer = providedProducer || '';
    let resolvedBeatId = beatId || null;

    // If beatId provided, fetch beat details
    if (beatId) {
      const { data: beat } = await serviceClient
        .from('beats')
        .select('title, producer, producer_id, cover_image_url')
        .eq('id', beatId)
        .single();

      if (beat) {
        beatTitle = beat.title || beatTitle;
        beatProducer = beat.producer || beatProducer;
      }
    }

    // Upload beat files if provided (custom beats)
    let mp3FilePath: string | null = null;
    let trackoutFilePath: string | null = null;
    const filePrefix = `private-sales/${Date.now()}`;

    if (beatFile && beatFile.size > 0) {
      mp3FilePath = `${filePrefix}/beat_${beatFile.name}`;
      const { error: uploadErr } = await serviceClient.storage.from('media').upload(mp3FilePath, beatFile);
      if (uploadErr) { console.error('Beat file upload error:', uploadErr); mp3FilePath = null; }
    }
    if (stemsFile && stemsFile.size > 0) {
      trackoutFilePath = `${filePrefix}/stems_${stemsFile.name}`;
      const { error: uploadErr } = await serviceClient.storage.from('media').upload(trackoutFilePath, stemsFile);
      if (uploadErr) { console.error('Stems file upload error:', uploadErr); trackoutFilePath = null; }
    }

    const token = crypto.randomUUID();

    // Get the profile ID for created_by (FK references profiles.id, not auth.users.id)
    const { data: creatorProfile } = await serviceClient
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!creatorProfile) {
      return NextResponse.json({ error: 'Profile not found for authenticated user' }, { status: 400 });
    }

    const { data: sale, error } = await serviceClient
      .from('private_beat_sales')
      .insert({
        token,
        beat_id: resolvedBeatId,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        license_type: licenseType,
        amount: amountCents,
        payment_method: paymentMethod || 'stripe',
        requires_payment: reqPayment,
        mp3_file_path: mp3FilePath,
        trackout_file_path: trackoutFilePath,
        notes: notes || null,
        beat_title: beatTitle,
        beat_producer: beatProducer,
        producer_id: producerId || (isProducer ? profileId : null),
        created_by: creatorProfile.id,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create private sale:', error);
      return NextResponse.json({ error: 'Failed to create private sale' }, { status: 500 });
    }

    // Send invite email
    const license = BEAT_LICENSES[licenseType as BeatLicenseType];
    await sendPrivateBeatSaleInvite(buyerEmail, {
      buyerName,
      beatTitle,
      producerName: beatProducer,
      licenseType: license.name,
      amount: amountCents,
      requiresPayment: reqPayment,
      token,
    });

    return NextResponse.json(sale);
  } catch (err) {
    console.error('Private sale creation error:', err);
    return NextResponse.json({ error: 'Failed to create private sale' }, { status: 500 });
  }
}

export async function GET() {
  const supabase = await createClient();
  const serviceClient = createServiceClient();

  const isAdmin = await verifyAdminAccess(supabase);
  const { isProducer, profileId } = await verifyProducerAccess(supabase);

  if (!isAdmin && !isProducer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    let query = serviceClient
      .from('private_beat_sales')
      .select('*, beats(title, producer, cover_image_url)')
      .order('created_at', { ascending: false });

    // Producers only see their own sales (created_by is profiles.id, not auth user.id)
    if (!isAdmin && isProducer && profileId) {
      query = query.or(`created_by.eq.${profileId},producer_id.eq.${profileId}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to list private sales:', error);
      return NextResponse.json({ error: 'Failed to list private sales' }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error('Private sale list error:', err);
    return NextResponse.json({ error: 'Failed to list private sales' }, { status: 500 });
  }
}
