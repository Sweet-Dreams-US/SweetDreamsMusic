// app/api/quotes/[token]/decline/route.ts
//
// POST — recipient declines a quote. No auth required (anyone with the
// token can decline; this is intentional — a customer who doesn't want
// to bother creating an account just clicks Decline and walks away).
//
// Body: { reason?: string }

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPackageQuoteDeclined } from '@/lib/email';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  let reason: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.reason === 'string') reason = body.reason.trim().slice(0, 500);
  } catch {
    // No body is fine — decline can be reasonless.
  }

  const service = createServiceClient();

  const { data: quoteRow } = await service
    .from('package_quotes')
    .select('id, template_id, user_id, band_id, status')
    .eq('token', token)
    .maybeSingle();
  if (!quoteRow) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  type Quote = { id: string; template_id: string; user_id: string | null; band_id: string | null; status: string };
  const quote = quoteRow as Quote;

  if (quote.status === 'declined') {
    return NextResponse.json({ ok: true, alreadyDeclined: true });
  }
  if (quote.status === 'accepted') {
    return NextResponse.json(
      { error: 'This quote was already accepted.' },
      { status: 400 },
    );
  }

  // Race-safe — sent → declined only.
  const { data: updated, error: updateErr } = await service
    .from('package_quotes')
    .update({
      status: 'declined',
      declined_at: new Date().toISOString(),
      // We re-use admin_notes to store the decline reason on the quote
      // since there's no dedicated decline_reason column. Visible to
      // admin only via the GET admin list (admin_notes excluded from
      // public quote-by-token response).
      admin_notes: reason ? `Declined: ${reason}` : 'Declined (no reason given)',
    })
    .eq('id', quote.id)
    .in('status', ['draft', 'sent'])
    .select('id');
  if (updateErr || !updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'Could not decline — refresh and try again.' },
      { status: 409 },
    );
  }

  // Notify admin of the decline.
  try {
    const { data: tpl } = await service
      .from('package_templates')
      .select('name')
      .eq('id', quote.template_id)
      .maybeSingle();
    const t = tpl as { name: string } | null;

    let recipientName = 'Recipient';
    let recipientEmail = '';
    if (quote.user_id) {
      const { data: profile } = await service
        .from('profiles')
        .select('display_name, email')
        .eq('user_id', quote.user_id)
        .maybeSingle();
      const p = profile as { display_name: string | null; email: string | null } | null;
      if (p) {
        recipientName = p.display_name ?? 'Recipient';
        recipientEmail = p.email ?? '';
      }
    } else if (quote.band_id) {
      const { data: band } = await service.from('bands').select('display_name').eq('id', quote.band_id).maybeSingle();
      recipientName = (band as { display_name: string } | null)?.display_name ?? 'Band';
    }

    if (t) {
      await sendPackageQuoteDeclined({
        templateName: t.name,
        recipientName,
        recipientEmail,
        declineReason: reason ?? null,
      });
    }
  } catch (e) {
    console.error('[quotes/decline] admin notify error:', e);
  }

  return NextResponse.json({ ok: true });
}
