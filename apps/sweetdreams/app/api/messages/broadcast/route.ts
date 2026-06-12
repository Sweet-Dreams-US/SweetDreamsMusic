// POST /api/messages/broadcast — the matrix-gated broadcast send (Plan 4 §3).
// Body: { segment, subject, body, emailMirror?, confirmCount? }.
//
// Admin → admin segments (everyone / all_artists / ... ); engineer + media
// manager → 'my_clients'; producer → 'my_buyers'; artists → 403. The audience
// resolves SERVER-SIDE at send time. Delivery = one ordinary message into each
// recipient's studio thread, attributed to the sender, tagged with the audit
// row id (admin_broadcasts) — replies land as normal conversation. Optional
// Resend email mirror. 'everyone' requires a confirm round-trip: the first call
// returns 409 + the exact count, the client re-posts with confirmCount.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { canBroadcast, type BroadcastSegment } from '@/lib/messaging-matrix';
import { resolveParty, resolveParties, resolveAudience, broadcastFanOut } from '@/lib/messaging-server';
import { sendBroadcastEmailBatch, broadcastHtml } from '@/lib/email';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  let body: {
    segment?: string; subject?: string; body?: string;
    emailMirror?: boolean; confirmCount?: number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const segment = String(body.segment ?? '');
  const subject = String(body.subject ?? '').trim();
  const text = String(body.body ?? '').trim();
  if (!segment || !subject || !text) {
    return NextResponse.json({ error: 'segment, subject and body are required' }, { status: 400 });
  }
  if (subject.length > 150 || text.length > 5000) {
    return NextResponse.json({ error: 'Subject max 150 chars; body max 5000.' }, { status: 400 });
  }

  const db = createServiceClient();
  const sender = await resolveParty(db, user.id);
  if (!sender) return NextResponse.json({ error: 'Profile lookup failed' }, { status: 500 });

  // THE matrix gate.
  const verdict = canBroadcast(sender, segment);
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason ?? 'Not allowed' }, { status: 403 });
  }

  const audience = await resolveAudience(db, sender, segment as BroadcastSegment);
  if (audience.userIds.length === 0) {
    return NextResponse.json({ error: 'That audience is empty right now.' }, { status: 400 });
  }

  // Rate guard: "everyone" needs an explicit confirm showing the exact count.
  if (segment === 'everyone' && body.confirmCount !== audience.userIds.length) {
    return NextResponse.json(
      { requiresConfirmation: true, count: audience.userIds.length },
      { status: 409 },
    );
  }

  // Audit row first — the broadcast id tags every fanned message.
  const recipients = await resolveParties(db, audience.userIds);
  const emails = recipients.map((r) => r.email).filter(Boolean);
  const { data: audit, error: auditErr } = await db.from('admin_broadcasts').insert({
    subject,
    body_html: broadcastHtml(subject, text, sender.name),
    template_key: 'matrix_broadcast',
    recipient_count: audience.userIds.length,
    recipient_emails: emails,
    sent_by: sender.email,
    audience_segment: segment,
    thread_delivery: true,
    email_delivery: body.emailMirror === true,
    sender_role: sender.role,
    sender_user_id: sender.userId,
  } as never).select('id').single();
  if (auditErr) return NextResponse.json({ error: `Audit insert failed: ${auditErr.message}` }, { status: 500 });

  const fanout = await broadcastFanOut(db, {
    sender, subject, body: text,
    userIds: audience.userIds,
    broadcastId: (audit as { id: string }).id,
  });

  let emailResult = { sent: 0, failed: 0 };
  if (body.emailMirror === true && emails.length > 0) {
    emailResult = await sendBroadcastEmailBatch(emails, subject, broadcastHtml(subject, text, sender.name));
  }

  return NextResponse.json({
    success: true,
    segment,
    audience: audience.userIds.length,
    delivered: fanout.delivered,
    failedThreads: fanout.failed,
    emailed: emailResult.sent,
    emailFailed: emailResult.failed,
  });
}
