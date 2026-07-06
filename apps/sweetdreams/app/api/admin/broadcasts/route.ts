import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { sendPendingBroadcast } from '@/lib/broadcast-send';

// GET — list broadcast history (now includes per-send delivery counters)
export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('admin_broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ broadcasts: data || [] });
}

// POST — send a broadcast email.
//
// Now per-recipient tracked + resumable: we insert the broadcast, materialize
// one broadcast_recipients row per (deduped) address as 'pending', then hand
// off to the shared sender. If Resend rate-limits/quota-stops partway, the
// remaining recipients stay 'pending' and the admin can hit the resume route
// to finish — with no duplicates to anyone already marked 'sent'.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();

  const { subject, bodyHtml, templateKey, recipientEmails } = await request.json();

  if (!subject || !bodyHtml || !recipientEmails || recipientEmails.length === 0) {
    return NextResponse.json({ error: 'subject, bodyHtml, and recipientEmails required' }, { status: 400 });
  }

  // Dedup recipients case-insensitively, preserving the first-seen casing.
  const seen = new Set<string>();
  const dedupedEmails: string[] = [];
  for (const raw of recipientEmails as string[]) {
    const email = (raw ?? '').trim();
    if (!email.includes('@')) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEmails.push(email);
  }

  if (dedupedEmails.length === 0) {
    return NextResponse.json({ error: 'No valid recipient emails' }, { status: 400 });
  }

  const service = createServiceClient();

  // 1. Insert the broadcast row in 'sending' state.
  const { data: broadcast, error: insErr } = await service
    .from('admin_broadcasts')
    .insert({
      subject,
      body_html: bodyHtml,
      template_key: templateKey || null,
      recipient_count: dedupedEmails.length,
      recipient_emails: dedupedEmails,
      sent_by: user?.email || null,
      sent_count: 0,
      failed_count: 0,
      send_status: 'sending',
    })
    .select('id')
    .single();

  if (insErr || !broadcast) {
    return NextResponse.json({ error: insErr?.message || 'Failed to create broadcast' }, { status: 500 });
  }

  // 2. Materialize per-recipient rows as 'pending'. We already deduped above,
  //    and the unique (broadcast_id, lower(email)) index is the backstop that
  //    guarantees a recipient can never be queued (and thus sent) twice.
  const recipientRows = dedupedEmails.map((email) => ({
    broadcast_id: broadcast.id,
    email,
    status: 'pending' as const,
  }));
  const { error: recErr } = await service
    .from('broadcast_recipients')
    .insert(recipientRows);

  if (recErr) {
    return NextResponse.json({ error: `Failed to queue recipients: ${recErr.message}` }, { status: 500 });
  }

  // 3. Send everyone that's pending. Returns live counts.
  const { sent, failed, pending } = await sendPendingBroadcast(broadcast.id);

  // Keep the original response shape (sentCount/failedCount/total) for the
  // existing UI, and add the resumable fields.
  return NextResponse.json({
    broadcastId: broadcast.id,
    sentCount: sent,
    failedCount: failed,
    pending,
    total: dedupedEmails.length,
  });
}
