// app/api/quotes/[token]/route.ts
//
// GET — public, returns a quote by its token. No auth required (matches
// the band-invite + event-RSVP token patterns).
//
// Returns enough to render /quotes/[token] page: template details, lines,
// totals, expiration, current status. Does NOT return admin_notes (those
// are internal only).

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const service = createServiceClient();

  const { data: quoteRow, error: qErr } = await service
    .from('package_quotes')
    .select('id, template_id, user_id, band_id, status, total_price_cents, total_full_price_cents, total_discount_cents, customer_message, expires_at, sent_at, accepted_at, declined_at')
    .eq('token', token)
    .maybeSingle();
  if (qErr) {
    console.error('[quotes/[token] GET]', qErr);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!quoteRow) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  type Quote = {
    id: string; template_id: string; user_id: string | null; band_id: string | null;
    status: string; total_price_cents: number; total_full_price_cents: number;
    total_discount_cents: number; customer_message: string | null; expires_at: string | null;
    sent_at: string | null; accepted_at: string | null; declined_at: string | null;
  };
  const quote = quoteRow as Quote;

  // Fetch the template + its lines for display.
  const [{ data: tplRow }, { data: linesRows }] = await Promise.all([
    service
      .from('package_templates')
      .select('name, description, audience, is_membership, membership_months, duration_days, price_cents')
      .eq('id', quote.template_id)
      .maybeSingle(),
    service
      .from('package_template_lines')
      .select('id, kind, quantity, full_price_cents, package_value_cents, notes, sort_order, media_offering_id')
      .eq('template_id', quote.template_id)
      .order('sort_order', { ascending: true }),
  ]);

  if (!tplRow) {
    return NextResponse.json({ error: 'Template missing' }, { status: 500 });
  }

  // Hydrate band display name when applicable, so the recipient sees
  // "for [BAND NAME]" on a band quote.
  let bandName: string | null = null;
  if (quote.band_id) {
    const { data: band } = await service.from('bands').select('display_name').eq('id', quote.band_id).maybeSingle();
    bandName = (band as { display_name: string } | null)?.display_name ?? null;
  }

  return NextResponse.json({
    quote: {
      id: quote.id,
      status: quote.status,
      total_price_cents: quote.total_price_cents,
      total_full_price_cents: quote.total_full_price_cents,
      total_discount_cents: quote.total_discount_cents,
      customer_message: quote.customer_message,
      expires_at: quote.expires_at,
      sent_at: quote.sent_at,
      accepted_at: quote.accepted_at,
      declined_at: quote.declined_at,
      band_id: quote.band_id,
      band_name: bandName,
    },
    template: tplRow,
    lines: linesRows ?? [],
  });
}
