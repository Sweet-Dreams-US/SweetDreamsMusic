// GET/POST/DELETE /api/admin/tax/expenses — expense entry + list. Admin only.
// GET ?year= returns rows + category totals + the year P&L. DELETE is soft.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { listExpenses, computePnL } from '@/lib/tax-server';
import { normalizeCategory, EQUIPMENT_SUGGEST_CENTS } from '@/lib/tax';

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
  const db = createServiceClient();
  const [expenses, pnl] = await Promise.all([
    listExpenses(db, `${year}-01-01`, `${year}-12-31`),
    computePnL(db, year),
  ]);
  return NextResponse.json({ year, expenses, pnl });
}

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const amountCents = Math.round(Number(body.amount_cents));
  const incurredOn = String(body.incurred_on || '').slice(0, 10);
  const description = String(body.description || '').trim();
  if (!Number.isFinite(amountCents) || amountCents <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)) return NextResponse.json({ error: 'Valid date required' }, { status: 400 });
  if (!description) return NextResponse.json({ error: 'Description required' }, { status: 400 });

  const category = normalizeCategory(body.category as string);
  // Auto-suggest the Section 179 flag over $2,500 unless the caller set it.
  const isEquipment = body.is_equipment != null ? !!body.is_equipment
    : (category === 'equipment' || amountCents >= EQUIPMENT_SUGGEST_CENTS);

  const db = createServiceClient();
  const { data, error } = await db.from('business_expenses').insert({
    studio_id: null, category, description, amount_cents: amountCents,
    incurred_on: incurredOn, vendor: body.vendor ? String(body.vendor) : null,
    receipt_storage_path: body.receipt_storage_path ? String(body.receipt_storage_path) : null,
    notes: body.notes ? String(body.notes) : null, is_equipment: isEquipment,
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
  const db = createServiceClient();
  const { error } = await db.from('business_expenses')
    .update({ deleted_at: new Date().toISOString(), deleted_by: g.user!.id } as never)
    .eq('id', id).is('deleted_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
