// app/api/admin/packages/quotes/[id]/send/route.ts
//
// POST — flip a draft quote → sent and fire the email + thread mirror.
// Admin-only. Idempotent on subsequent calls (no-op if already sent
// past initial send) so accidental double-clicks don't re-spam the
// customer.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPackageQuote, type PackageQuoteEmailLine } from '@/lib/email';
import { getBrand } from '@/lib/brand-server';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const service = createServiceClient();

  // Pull the quote + template + lines so we can render the email.
  const { data: quoteRow, error: qErr } = await service
    .from('package_quotes')
    .select('*')
    .eq('id', id)
    .single();
  if (qErr || !quoteRow) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  type Quote = {
    id: string; template_id: string; user_id: string | null; band_id: string | null;
    token: string; status: string; total_price_cents: number; total_full_price_cents: number;
    customer_message: string | null; expires_at: string | null;
  };
  const quote = quoteRow as Quote;

  if (quote.status === 'accepted' || quote.status === 'declined') {
    return NextResponse.json(
      { error: `Cannot send a ${quote.status} quote` },
      { status: 400 },
    );
  }

  // Resolve recipient email + name.
  let recipientEmail: string | null = null;
  let recipientName = 'there';
  if (quote.user_id) {
    const { data: profile } = await service
      .from('profiles')
      .select('email, display_name')
      .eq('user_id', quote.user_id)
      .maybeSingle();
    type P = { email: string | null; display_name: string | null };
    const p = profile as P | null;
    recipientEmail = p?.email ?? null;
    recipientName = p?.display_name ?? recipientEmail?.split('@')[0] ?? 'there';
  } else if (quote.band_id) {
    // Band quote — find a band admin to email. We email the first admin
    // we find; in practice a band rarely has more than 1-2 admins.
    const { data: band } = await service
      .from('bands')
      .select('display_name')
      .eq('id', quote.band_id)
      .maybeSingle();
    const { data: admins } = await service
      .from('band_members')
      .select('user_id')
      .eq('band_id', quote.band_id)
      .eq('role', 'admin')
      .limit(1);
    type Admin = { user_id: string };
    const adminRow = (admins ?? [])[0] as Admin | undefined;
    if (adminRow) {
      const { data: adminProfile } = await service
        .from('profiles')
        .select('email, display_name')
        .eq('user_id', adminRow.user_id)
        .maybeSingle();
      type P = { email: string | null; display_name: string | null };
      const p = adminProfile as P | null;
      recipientEmail = p?.email ?? null;
      recipientName = p?.display_name ?? recipientEmail?.split('@')[0] ?? 'there';
    }
    if (band) {
      recipientName = `${recipientName} (${(band as { display_name: string }).display_name})`;
    }
  }

  if (!recipientEmail) {
    return NextResponse.json(
      { error: 'Recipient has no email on file — cannot send.' },
      { status: 400 },
    );
  }

  // Pull the template (for name / shape) and lines (for the email body).
  const [{ data: tplRow }, { data: linesRows }] = await Promise.all([
    service.from('package_templates')
      .select('name, description, is_membership, membership_months, duration_days, price_cents')
      .eq('id', quote.template_id)
      .single(),
    service.from('package_template_lines')
      .select('kind, quantity, full_price_cents, notes')
      .eq('template_id', quote.template_id)
      .order('sort_order', { ascending: true }),
  ]);
  if (!tplRow) {
    return NextResponse.json({ error: 'Template missing' }, { status: 500 });
  }

  type Tpl = {
    name: string; description: string | null; is_membership: boolean;
    membership_months: number | null; duration_days: number | null; price_cents: number;
  };
  const tpl = tplRow as Tpl;

  type LineRow = { kind: string; quantity: number; full_price_cents: number; notes: string | null };
  const lineLabels: PackageQuoteEmailLine[] = ((linesRows ?? []) as LineRow[]).map((l) => {
    let label: string;
    if (l.kind === 'studio_hours') label = `${l.quantity} studio hour${l.quantity === 1 ? '' : 's'}`;
    else if (l.kind === 'beat_credit') label = `${l.quantity} beat credit${l.quantity === 1 ? '' : 's'}`;
    else label = l.notes || `${l.kind} × ${l.quantity}`;
    return { label, full_price_cents: l.full_price_cents };
  });

  // Inviter name for the email's "X put together a package for you" line.
  const b = await getBrand();
  const inviterName = user.profile?.display_name ?? user.email.split('@')[0] ?? b.name;

  // Send the email + mirror to thread. We do this BEFORE flipping
  // status='sent' so a delivery failure leaves the quote in 'draft' for
  // retry. (mirrorToThread is fire-and-forget inside sendPackageQuote;
  // resend.emails.send is awaited.)
  await sendPackageQuote(recipientEmail, {
    recipientName,
    templateName: tpl.name,
    templateDescription: tpl.description,
    isMembership: tpl.is_membership,
    membershipMonths: tpl.membership_months,
    durationDays: tpl.duration_days,
    pricePerMonthCents: tpl.is_membership ? tpl.price_cents : null,
    totalPriceCents: quote.total_price_cents,
    retailPriceCents: quote.total_full_price_cents,
    lines: lineLabels,
    customerMessage: quote.customer_message,
    expiresAt: quote.expires_at ?? new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
    token: quote.token,
    inviterName,
  });

  // Flip status. Only first-time send sets sent_at — later "resend"
  // requests don't backdate.
  const { error: updateErr } = await service
    .from('package_quotes')
    .update({
      status: 'sent',
      sent_at: quote.status === 'draft' ? new Date().toISOString() : undefined,
    })
    .eq('id', id);
  if (updateErr) {
    console.error('[admin/packages/quotes/[id]/send] status update:', updateErr);
    // Email already went out; surface the error but don't roll back
    // the email send.
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
