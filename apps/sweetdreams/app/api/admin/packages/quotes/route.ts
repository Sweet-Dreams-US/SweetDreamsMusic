// app/api/admin/packages/quotes/route.ts
//
// GET — list all quotes (admin), with template name + recipient hydrated.
// POST — create a draft quote from a template, snapshotting prices.
//
// Both admin-only. Sending a draft quote (which fires email + thread
// mirror) is a separate endpoint at .../[id]/send/route.ts so admin
// can preview before committing the customer-facing message.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const DEFAULT_QUOTE_VALIDITY_DAYS = 14;

interface CreateQuotePayload {
  template_id?: string;
  /** Exactly one of user_id / band_id required, matching the template's audience. */
  user_id?: string;
  band_id?: string;
  /** ISO; defaults to now() + 14 days. */
  expires_at?: string;
  customer_message?: string | null;
  admin_notes?: string | null;
  /** Per-quote line tweaks: shape `[{ template_line_id, quantity?, package_value_cents? }]`. */
  custom_adjustments?: unknown;
  /** Optional salesperson attribution. Both must be set together, or
   *  both null. Null = no commission (the default). */
  salesperson_name?: string | null;
  /** Commission as a whole-number percentage, 0-100 (e.g. 15 = 15%). */
  sales_commission_pct?: number | null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status'); // 'draft','sent','accepted','declined','expired' or null

  const service = createServiceClient();

  let query = service
    .from('package_quotes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (statusFilter) query = query.eq('status', statusFilter);
  const { data: quotes, error } = await query;
  if (error) {
    console.error('[admin/packages/quotes GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type QuoteRow = {
    id: string; template_id: string; user_id: string | null; band_id: string | null;
    token: string; status: string; total_price_cents: number; total_full_price_cents: number;
    total_discount_cents: number; expires_at: string | null; sent_at: string | null;
    accepted_at: string | null; declined_at: string | null; created_at: string;
    customer_message: string | null; admin_notes: string | null;
  };
  const rows = (quotes ?? []) as QuoteRow[];

  if (rows.length === 0) return NextResponse.json({ quotes: [] });

  // Hydrate template names + recipient names.
  const templateIds = Array.from(new Set(rows.map((r) => r.template_id)));
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x)));
  const bandIds = Array.from(new Set(rows.map((r) => r.band_id).filter((x): x is string => !!x)));

  const [tplRes, profRes, bandRes] = await Promise.all([
    service.from('package_templates').select('id, name, is_membership').in('id', templateIds),
    userIds.length
      ? service.from('profiles').select('user_id, display_name, email').in('user_id', userIds)
      : Promise.resolve({ data: [] }),
    bandIds.length
      ? service.from('bands').select('id, display_name').in('id', bandIds)
      : Promise.resolve({ data: [] }),
  ]);

  const tplMap = new Map<string, { name: string; is_membership: boolean }>();
  for (const t of (tplRes.data ?? []) as Array<{ id: string; name: string; is_membership: boolean }>) {
    tplMap.set(t.id, { name: t.name, is_membership: t.is_membership });
  }
  const profMap = new Map<string, { display_name: string | null; email: string | null }>();
  for (const p of (profRes.data ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
    profMap.set(p.user_id, p);
  }
  const bandMap = new Map<string, { display_name: string }>();
  for (const b of (bandRes.data ?? []) as Array<{ id: string; display_name: string }>) {
    bandMap.set(b.id, b);
  }

  const hydrated = rows.map((q) => {
    const tpl = tplMap.get(q.template_id);
    const recipient = q.user_id
      ? profMap.get(q.user_id)
      : q.band_id
        ? bandMap.get(q.band_id)
        : null;
    return {
      ...q,
      template_name: tpl?.name ?? '(deleted template)',
      template_is_membership: tpl?.is_membership ?? false,
      recipient_name: q.user_id
        ? (profMap.get(q.user_id)?.display_name ?? null)
        : (recipient && 'display_name' in recipient ? recipient.display_name : null),
      recipient_email: q.user_id ? (profMap.get(q.user_id)?.email ?? null) : null,
    };
  });

  return NextResponse.json({ quotes: hydrated });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  let body: CreateQuotePayload;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  if (!body.template_id) {
    return NextResponse.json({ error: 'template_id required' }, { status: 400 });
  }
  const hasUser = !!body.user_id;
  const hasBand = !!body.band_id;
  if (hasUser === hasBand) {
    return NextResponse.json({ error: 'Exactly one of user_id or band_id required' }, { status: 400 });
  }

  const service = createServiceClient();

  // Pull template + lines so we can snapshot the totals.
  const { data: template, error: tplErr } = await service
    .from('package_templates')
    .select('*')
    .eq('id', body.template_id)
    .single();
  if (tplErr || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  type Tpl = {
    id: string; audience: 'solo' | 'band'; is_membership: boolean;
    membership_months: number | null; price_cents: number; is_active: boolean;
  };
  const tpl = template as Tpl;
  if (!tpl.is_active) {
    return NextResponse.json({ error: 'Template is archived' }, { status: 400 });
  }
  if (tpl.audience === 'solo' && !hasUser) {
    return NextResponse.json({ error: 'Solo template requires user_id' }, { status: 400 });
  }
  if (tpl.audience === 'band' && !hasBand) {
    return NextResponse.json({ error: 'Band template requires band_id' }, { status: 400 });
  }

  const { data: lines, error: linesErr } = await service
    .from('package_template_lines')
    .select('*')
    .eq('template_id', body.template_id)
    .order('sort_order', { ascending: true });
  if (linesErr) {
    return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }
  type Line = { full_price_cents: number; package_value_cents: number };
  const linesArr = (lines ?? []) as Line[];

  // Snapshot totals at this moment. The customer will see these numbers
  // even if admin edits the template later.
  const totalFullPrice = linesArr.reduce((s, l) => s + l.full_price_cents, 0);
  const totalPrice = tpl.is_membership
    ? tpl.price_cents * (tpl.membership_months ?? 0)
    : tpl.price_cents;
  const totalDiscount = Math.max(0, totalFullPrice - totalPrice);

  const expiresAt = body.expires_at
    ? new Date(body.expires_at).toISOString()
    : new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // 256 bits of entropy, hex-encoded → URL-safe.
  const token = randomBytes(32).toString('hex');

  // Salesperson attribution — optional, but both fields move together.
  // If a name is given without a pct (or vice versa), reject rather than
  // silently storing a half-set commission.
  const salespersonName = body.salesperson_name?.trim() || null;
  const salesCommissionPct =
    typeof body.sales_commission_pct === 'number' ? body.sales_commission_pct : null;
  if (salespersonName && (salesCommissionPct === null || salesCommissionPct < 0 || salesCommissionPct > 100)) {
    return NextResponse.json(
      { error: 'A salesperson requires a commission percentage between 0 and 100.' },
      { status: 400 },
    );
  }
  if (!salespersonName && salesCommissionPct !== null) {
    return NextResponse.json(
      { error: 'A commission percentage requires a salesperson name.' },
      { status: 400 },
    );
  }

  const { data: created, error: insertErr } = await service
    .from('package_quotes')
    .insert({
      template_id: body.template_id,
      user_id: body.user_id ?? null,
      band_id: body.band_id ?? null,
      token,
      status: 'draft',
      total_price_cents: totalPrice,
      total_full_price_cents: totalFullPrice,
      total_discount_cents: totalDiscount,
      custom_adjustments: body.custom_adjustments ?? null,
      admin_notes: body.admin_notes ?? null,
      customer_message: body.customer_message ?? null,
      expires_at: expiresAt,
      created_by_user_id: user.id,
      salesperson_name: salespersonName,
      sales_commission_pct: salesCommissionPct,
    })
    .select('*')
    .single();

  if (insertErr || !created) {
    console.error('[admin/packages/quotes POST]', insertErr);
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({ quote: created });
}
