import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { SITE_URL } from '@/lib/constants';
import { emailIdentity, footerLine } from '@/lib/email';

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#000;font-family:'IBM Plex Mono',monospace;color:#fff"><div style="max-width:600px;margin:0 auto;padding:40px 24px">${content}<div style="margin-top:40px;padding-top:24px;border-top:1px solid #333;text-align:center"><p style="color:#666;font-size:11px;margin:0">${footerLine()}</p><p style="color:#666;font-size:11px;margin:4px 0 0"><a href="${SITE_URL}" style="color:#F4C430;text-decoration:none">${SITE_URL.replace(/^https?:\/\//, '')}</a></p></div></div></body></html>`;
}

// GET — list broadcast history
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

// POST — send a broadcast email
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();

  const { subject, bodyHtml, templateKey, recipientEmails } = await request.json();

  if (!subject || !bodyHtml || !recipientEmails || recipientEmails.length === 0) {
    return NextResponse.json({ error: 'subject, bodyHtml, and recipientEmails required' }, { status: 400 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  // Resolve the FROM identity first — this also warms the brand cache that
  // footerLine() (inside wrapEmail) reads synchronously.
  const from = await emailIdentity();
  const fullHtml = wrapEmail(bodyHtml);

  let sentCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  // Use Resend's batch API: one API call for up to 100 emails, each tracked
  // separately on their side. This replaces N sequential .emails.send calls
  // (which caused 429s on Resend's lower-tier per-second cap when a broadcast
  // had more than 10 recipients). Between batches we sleep 500ms — so at most
  // 2 API calls/sec, comfortably under any Resend plan's limit.
  const BATCH_SIZE = 100;
  const INTER_BATCH_MS = 500;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < recipientEmails.length; i += BATCH_SIZE) {
    const chunk = recipientEmails.slice(i, i + BATCH_SIZE) as string[];
    const payload = chunk.map((email) => ({ from, to: email, subject, html: fullHtml }));

    try {
      const result = await resend.batch.send(payload);
      // Resend's batch response carries per-email results in result.data.data.
      // On plain success, count the whole chunk. On partial-error shapes, be
      // defensive and attribute failures to individual recipients.
      const ok = !result.error;
      if (ok) {
        sentCount += chunk.length;
      } else {
        failedCount += chunk.length;
        errors.push(`batch ${i / BATCH_SIZE}: ${result.error?.message ?? 'unknown error'}`);
      }
    } catch (e) {
      failedCount += chunk.length;
      errors.push(`batch ${i / BATCH_SIZE}: ${(e as Error).message}`);
    }

    // Throttle between batches (skip the sleep after the last chunk).
    if (i + BATCH_SIZE < recipientEmails.length) await sleep(INTER_BATCH_MS);
  }

  // Log the broadcast
  const service = createServiceClient();
  await service.from('admin_broadcasts').insert({
    subject,
    body_html: bodyHtml,
    template_key: templateKey || null,
    recipient_count: sentCount,
    recipient_emails: recipientEmails,
    sent_by: user?.email || null,
  });

  return NextResponse.json({ sentCount, failedCount, errors, total: recipientEmails.length });
}
