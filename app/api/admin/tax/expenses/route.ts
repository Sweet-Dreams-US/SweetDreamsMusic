// GET/POST/DELETE /api/admin/tax/expenses — expense entry + list. Admin only.
// GET ?year= returns rows + category totals + the year P&L. DELETE is soft.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { listExpenses, computePnL, getTaxConstants } from '@/lib/tax-server';
import { normalizeCategory, EQUIPMENT_SUGGEST_CENTS, EXPENSE_CATEGORY_KEYS, deductiblePctFor } from '@/lib/tax';

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const params = new URL(request.url).searchParams;
  const db = createServiceClient();
  // categoryPcts: the period-year's deductible percentages so UI chips are
  // YEAR-AWARE (staff meals 50% in 2025, 0% in 2026 — client-side defaults
  // can't know the year).
  const pctsFor = async (y: number) => {
    const c = await getTaxConstants(db, y);
    return Object.fromEntries(EXPENSE_CATEGORY_KEYS.map((k) => [k, deductiblePctFor(k, c)]));
  };

  // Range mode (the Accounting Profit view's period selector)…
  const from = params.get('from'), to = params.get('to');
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({
      from, to, expenses: await listExpenses(db, from, to),
      categoryPcts: await pctsFor(Number(from.slice(0, 4))),
    });
  }
  // …or whole-year mode (the Tax Center).
  const year = Number(params.get('year')) || new Date().getUTCFullYear();
  const [expenses, pnl, categoryPcts] = await Promise.all([
    listExpenses(db, `${year}-01-01`, `${year}-12-31`),
    computePnL(db, year),
    pctsFor(year),
  ]);
  return NextResponse.json({ year, expenses, pnl, categoryPcts });
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
  // Section 179: ONLY the equipment category auto-flags (the audit caught the
  // old >$2,500-in-any-category rule putting rent on the CPA's equipment tab).
  // The UI's amber hint suggests the category for big purchases; the owner
  // decides. EQUIPMENT_SUGGEST_CENTS drives the hint only.
  const isEquipment = body.is_equipment != null ? !!body.is_equipment : category === 'equipment';

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

export async function PATCH(request: NextRequest) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.amount_cents != null) {
    const n = Math.round(Number(body.amount_cents));
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    updates.amount_cents = n;
  }
  if (body.incurred_on != null) {
    const d = String(body.incurred_on).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: 'Valid date required' }, { status: 400 });
    updates.incurred_on = d;
  }
  if (body.description != null) {
    const s = String(body.description).trim();
    if (!s) return NextResponse.json({ error: 'Description required' }, { status: 400 });
    updates.description = s;
  }
  if (body.category != null) updates.category = normalizeCategory(body.category as string);
  if (body.vendor != null) updates.vendor = body.vendor === '' ? null : String(body.vendor);
  if (body.notes != null) updates.notes = body.notes === '' ? null : String(body.notes);
  if (body.is_equipment != null) updates.is_equipment = !!body.is_equipment;
  if (body.receipt_storage_path != null) updates.receipt_storage_path = body.receipt_storage_path === '' ? null : String(body.receipt_storage_path);
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 });

  const db = createServiceClient();
  const { error } = await db.from('business_expenses').update(updates as never)
    .eq('id', id).is('deleted_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
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
