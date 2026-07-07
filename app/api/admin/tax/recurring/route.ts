// /api/admin/tax/recurring — recurring expense templates (monthly rent,
// software subs). The audit found the table 100% orphaned: no UI, no route,
// no cron. GET / POST / PATCH / DELETE; the recurring-expenses cron
// materializes business_expenses rows monthly. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeCategory } from '@/lib/tax';
import { backfillRecurringTemplate } from '@/lib/tax-recurring-server';

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
  const category = normalizeCategory(body.category as string);
  const vendor = body.vendor ? String(body.vendor) : null;
  if (!label) return NextResponse.json({ error: 'Label required' }, { status: 400 });
  if (!Number.isFinite(amountCents) || amountCents <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  if (!(dayOfMonth >= 1 && dayOfMonth <= 28)) return NextResponse.json({ error: 'Day must be 1–28' }, { status: 400 });

  // Optional start month ('YYYY-MM') — the month the monthly expense begins.
  // Defaults to the current month. We backfill business_expenses rows from this
  // month through the current month immediately (so it shows in the P&L now and
  // applies "from that time forward"); the cron continues future months.
  const now = new Date();
  const curPeriod = now.toISOString().slice(0, 7);
  const rawStart = String(body.start_period || '').slice(0, 7);
  const startPeriod = /^\d{4}-\d{2}$/.test(rawStart) && rawStart <= curPeriod ? rawStart : curPeriod;

  const db = createServiceClient();
  const { data, error } = await db.from('recurring_expense_templates').insert({
    studio_id: null, label, category,
    amount_cents: amountCents, vendor,
    day_of_month: dayOfMonth, active: true, created_by: g.user!.id,
  } as never).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const id = (data as { id: string }).id;

  // Backfill from the start month → now (idempotent), then stamp
  // last_materialized_period so the cron picks up from next month without
  // re-creating the current one.
  let created = 0;
  try {
    const res = await backfillRecurringTemplate(
      db,
      { id, category, label, amount_cents: amountCents, vendor, day_of_month: dayOfMonth, created_by: g.user!.id },
      startPeriod,
      now,
    );
    created = res.created;
    await db.from('recurring_expense_templates')
      .update({ last_materialized_period: curPeriod } as never)
      .eq('id', id);
  } catch (e) {
    console.error('[tax/recurring POST] backfill failed:', e);
    // Template still exists; the cron will materialize going forward.
  }

  return NextResponse.json({ success: true, id, backfilled: created });
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
