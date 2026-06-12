// /api/admin/tax/payments — the ACTUAL estimated-tax payments ledger. Closes
// the suggest → pay → reconcile loop: later quarters subtract what was really
// paid. GET ?year=  POST {tax_year, quarter, paid_cents, paid_on, confirmation}
// DELETE ?id=. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getUTCFullYear();
  const { data } = await createServiceClient().from('tax_payments')
    .select('*').eq('tax_year', year).is('studio_id', null).order('paid_on', { ascending: true });
  return NextResponse.json({ year, payments: data ?? [] });
}

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const taxYear = Math.round(Number(body.tax_year));
  const quarter = Math.round(Number(body.quarter));
  const paidCents = Math.round(Number(body.paid_cents));
  const paidOn = String(body.paid_on || '').slice(0, 10);
  if (!(taxYear >= 2020 && taxYear <= 2100)) return NextResponse.json({ error: 'Valid tax year required' }, { status: 400 });
  if (!(quarter >= 1 && quarter <= 4)) return NextResponse.json({ error: 'Quarter must be 1–4' }, { status: 400 });
  if (!Number.isFinite(paidCents) || paidCents < 0) return NextResponse.json({ error: 'Amount must be ≥ 0' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return NextResponse.json({ error: 'Valid payment date required' }, { status: 400 });

  const { data, error } = await createServiceClient().from('tax_payments').insert({
    studio_id: null, tax_year: taxYear, quarter, paid_cents: paidCents, paid_on: paidOn,
    confirmation: body.confirmation ? String(body.confirmation) : null,
    note: body.note ? String(body.note) : null,
    created_by: g.user!.id,
  } as never).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: (data as { id: string }).id });
}

export async function DELETE(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await createServiceClient().from('tax_payments').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
