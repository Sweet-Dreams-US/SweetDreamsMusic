// /api/admin/tax/recurring — recurring expense templates (monthly rent,
// software subs). The audit found the table 100% orphaned: no UI, no route,
// no cron. GET / POST / PATCH / DELETE; the recurring-expenses cron
// materializes business_expenses rows monthly. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeCategory } from '@/lib/tax';

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const { data } = await createServiceClient().from('recurring_expense_templates')
    .select('*').order('created_at', { ascending: true });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const label = String(body.label || '').trim();
  const amountCents = Math.round(Number(body.amount_cents));
  const dayOfMonth = Math.round(Number(body.day_of_month ?? 1));
  if (!label) return NextResponse.json({ error: 'Label required' }, { status: 400 });
  if (!Number.isFinite(amountCents) || amountCents <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  if (!(dayOfMonth >= 1 && dayOfMonth <= 28)) return NextResponse.json({ error: 'Day must be 1–28' }, { status: 400 });

  const { data, error } = await createServiceClient().from('recurring_expense_templates').insert({
    studio_id: null, label, category: normalizeCategory(body.category as string),
    amount_cents: amountCents, vendor: body.vendor ? String(body.vendor) : null,
    day_of_month: dayOfMonth, active: true, created_by: g.user!.id,
  } as never).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: (data as { id: string }).id });
}

export async function PATCH(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const updates: Record<string, unknown> = {};
  if (body.active != null) updates.active = !!body.active;
  if (body.amount_cents != null) {
    const n = Math.round(Number(body.amount_cents));
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    updates.amount_cents = n;
  }
  if (body.label != null) updates.label = String(body.label);
  if (body.vendor != null) updates.vendor = body.vendor === '' ? null : String(body.vendor);
  if (body.category != null) updates.category = normalizeCategory(body.category as string);
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 });
  const { error } = await createServiceClient().from('recurring_expense_templates').update(updates as never).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await createServiceClient().from('recurring_expense_templates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
