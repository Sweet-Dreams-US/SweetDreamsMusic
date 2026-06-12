// app/api/admin/packages/entitlements/[id]/extend/route.ts
//
// POST — admin generates an extension quote for a customer's existing
// membership. Body:
//   { months: number, customer_message?: string, admin_notes?: string }
//
// Mints a quote with:
//   • template_id = the original membership's template
//   • extends_entitlement_id = the existing entitlement's id (this
//     marks the quote as an extension rather than a fresh purchase)
//   • Same per-month price as the original membership
//   • total_price_cents = monthly_price × months (the new contract value)
//   • status='draft' — admin reviews + sends from the Quotes inbox
//
// When the customer accepts + pays, the webhook recognizes the
// `extends_entitlement_id` and instead of minting a new entitlement,
// it bumps the existing one's ends_at + adds proportional balance lines.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const DEFAULT_QUOTE_VALIDITY_DAYS = 14;

interface ExtendBody {
  months?: number;
  customer_message?: string | null;
  admin_notes?: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id: entitlementId } = await params;
  if (!entitlementId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: ExtendBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (typeof body.months !== 'number' || body.months <= 0 || body.months > 24) {
    return NextResponse.json({ error: 'months must be 1-24' }, { status: 400 });
  }

  const service = createServiceClient();

  // Pull the entitlement + its template so we know the membership rate.
  const { data: entRow } = await service
    .from('package_entitlements')
    .select('id, template_id, user_id, band_id, status')
    .eq('id', entitlementId)
    .maybeSingle();
  if (!entRow) return NextResponse.json({ error: 'Entitlement not found' }, { status: 404 });
  type Ent = { id: string; template_id: string; user_id: string | null; band_id: string | null; status: string };
  const ent = entRow as Ent;

  if (ent.status !== 'active') {
    return NextResponse.json({ error: 'Can only extend active entitlements' }, { status: 400 });
  }

  const { data: tplRow } = await service
    .from('package_templates')
    .select('id, name, is_membership, membership_months, price_cents, audience')
    .eq('id', ent.template_id)
    .maybeSingle();
  if (!tplRow) return NextResponse.json({ error: 'Template missing' }, { status: 500 });
  type Tpl = { id: string; name: string; is_membership: boolean; membership_months: number | null; price_cents: number; audience: 'solo' | 'band' };
  const tpl = tplRow as Tpl;

  if (!tpl.is_membership) {
    return NextResponse.json({ error: 'Only memberships can be extended.' }, { status: 400 });
  }

  // Pull the original template lines so we can replicate them
  // proportionally for the extension. For each line, we'll later
  // (in the webhook) add `(line.quantity * months / original_months)`
  // additional units to the entitlement balance — but we capture the
  // pricing snapshot in the quote totals here.
  const { data: lineRows } = await service
    .from('package_template_lines')
    .select('full_price_cents, package_value_cents')
    .eq('template_id', tpl.id);
  type Line = { full_price_cents: number; package_value_cents: number };
  const lines = (lineRows ?? []) as Line[];
  const originalMonths = tpl.membership_months ?? 3;

  // Per-month value of the entire basket (full retail), used for the
  // discount-vs-retail math on the quote.
  const totalFullPricePerOriginal = lines.reduce((s, l) => s + l.full_price_cents, 0);
  const fullPricePerMonth = Math.round(totalFullPricePerOriginal / originalMonths);
  const totalFullPriceForExtension = fullPricePerMonth * body.months;

  const totalPriceForExtension = tpl.price_cents * body.months;
  const totalDiscount = Math.max(0, totalFullPriceForExtension - totalPriceForExtension);

  const expiresAt = new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_DAYS * 86400 * 1000).toISOString();
  const token = randomBytes(32).toString('hex');

  const { data: created, error: insertErr } = await service
    .from('package_quotes')
    .insert({
      template_id: tpl.id,
      user_id: ent.user_id,
      band_id: ent.band_id,
      token,
      status: 'draft',
      total_price_cents: totalPriceForExtension,
      total_full_price_cents: totalFullPriceForExtension,
      total_discount_cents: totalDiscount,
      admin_notes: body.admin_notes ?? `Extension of entitlement ${entitlementId} by ${body.months} month(s).`,
      customer_message: body.customer_message ?? null,
      expires_at: expiresAt,
      created_by_user_id: user.id,
      extends_entitlement_id: entitlementId,
    })
    .select('*')
    .single();
  if (insertErr || !created) {
    console.error('[extend] insert:', insertErr);
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({
    quote: created,
    months: body.months,
    monthly_price_cents: tpl.price_cents,
    total_extension_value_cents: totalPriceForExtension,
  });
}
