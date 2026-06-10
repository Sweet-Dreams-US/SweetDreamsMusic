// lib/tax-recurring-server.ts — materializes recurring expense templates into
// business_expenses rows once per month (the cron calls this; the golden test
// drives it directly). Idempotent via last_materialized_period ('YYYY-MM').

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

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
