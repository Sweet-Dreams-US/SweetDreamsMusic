// lib/tax-recurring-server.ts — materializes recurring expense templates into
// business_expenses rows once per month (the cron calls this; the golden test
// drives it directly). Idempotent via last_materialized_period ('YYYY-MM').

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/** Inclusive list of 'YYYY-MM' periods from start→end (capped at 24 to avoid
 *  runaway backfills). Returns [] if start is after end. */
export function monthsInclusive(startPeriod: string, endPeriod: string, cap = 24): string[] {
  const parse = (p: string) => {
    const [y, m] = p.split('-').map(Number);
    return { y, m };
  };
  if (!/^\d{4}-\d{2}$/.test(startPeriod) || !/^\d{4}-\d{2}$/.test(endPeriod)) return [];
  const s = parse(startPeriod);
  const e = parse(endPeriod);
  const out: string[] = [];
  let y = s.y, m = s.m;
  while ((y < e.y || (y === e.y && m <= e.m)) && out.length < cap) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Backfill a recurring template into business_expenses for every month from
 * `startPeriod` ('YYYY-MM') through the current month, inclusive. Idempotent:
 * skips any month that already has a (non-deleted) row for this template, so
 * it's safe to call alongside the cron. Used when an admin creates a monthly
 * expense mid-stream so it applies "from that time forward" and shows up
 * immediately in the P&L instead of waiting for the cron's day-of-month.
 */
export async function backfillRecurringTemplate(
  db: Client,
  template: { id: string; category: string; label: string; amount_cents: number; vendor: string | null; day_of_month: number | null; created_by: string | null },
  startPeriod: string,
  now: Date = new Date(),
): Promise<{ created: number }> {
  const curPeriod = now.toISOString().slice(0, 7);
  const dd = String(template.day_of_month ?? 1).padStart(2, '0');
  let created = 0;
  for (const period of monthsInclusive(startPeriod, curPeriod)) {
    const monthStart = `${period}-01`;
    const monthEnd = `${period}-31`;
    const { data: existing } = await db.from('business_expenses')
      .select('id')
      .eq('recurring_template_id', template.id)
      .gte('incurred_on', monthStart)
      .lte('incurred_on', monthEnd)
      .is('deleted_at', null)
      .limit(1);
    if (existing && existing.length > 0) continue;
    const { error } = await db.from('business_expenses').insert({
      studio_id: null, category: template.category, description: template.label,
      amount_cents: template.amount_cents, incurred_on: `${period}-${dd}`,
      vendor: template.vendor ?? null, recurring_template_id: template.id,
      created_by: template.created_by ?? null,
    } as never);
    if (!error) created++;
  }
  return { created };
}

export async function materializeRecurringExpenses(db: Client, now: Date = new Date()):
  Promise<{ checked: number; created: number }> {
  const period = now.toISOString().slice(0, 7);          // 'YYYY-MM'
  const today = now.getUTCDate();

  const { data: templates, error } = await db.from('recurring_expense_templates')
    .select('*').eq('active', true);
  if (error) {
    console.error('[tax-recurring] template read failed:', error.message);
    return { checked: 0, created: 0 };
  }

  let created = 0;
  for (const t of (templates ?? []) as any[]) {
    if (t.last_materialized_period === period) continue;  // already done this month
    if (today < (t.day_of_month ?? 1)) continue;          // not its day yet

    // Stamp the period FIRST (dedup before side effect — the house lesson):
    // a lost month costs one manual entry; an unstamped insert duplicates rent.
    // NULL-safe claim: `.neq()` alone skips NULL rows (Postgres NULL semantics),
    // so branch on the value we just read; requiring the UPDATE to return the
    // claimed row means a concurrent run can never double-materialize.
    const base = db.from('recurring_expense_templates')
      .update({ last_materialized_period: period } as never)
      .eq('id', t.id);
    const guarded = t.last_materialized_period == null
      ? base.is('last_materialized_period', null)
      : base.neq('last_materialized_period', period);
    const { data: claimed, error: stampErr } = await guarded.select('id');
    if (stampErr) { console.error('[tax-recurring] stamp failed:', stampErr.message); continue; }
    if (!claimed || claimed.length === 0) continue; // someone else claimed this month

    const incurredOn = `${period}-${String(t.day_of_month ?? 1).padStart(2, '0')}`;
    const { error: insErr } = await db.from('business_expenses').insert({
      studio_id: null, category: t.category, description: t.label,
      amount_cents: t.amount_cents, incurred_on: incurredOn,
      vendor: t.vendor ?? null, recurring_template_id: t.id, created_by: t.created_by ?? null,
    } as never);
    if (insErr) { console.error('[tax-recurring] insert failed:', insErr.message); continue; }
    created++;
  }
  return { checked: (templates ?? []).length, created };
}
