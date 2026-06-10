// lib/tax-reminders-server.ts — quarterly estimate reminders (Plan 5 Phase 4).
// Delivers an admin-only nudge into each admin's studio thread (+ optional
// email) at 30 and 7 days before each estimated-tax due date. Idempotent per
// (year, quarter, window) via tax_estimate_snapshots.assumptions.reminders.
//
// Held safe: NO-OPS unless the year's tax_constants.reviewed = true — drafts
// never fire reminders at a studio.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeEstimates } from '@/lib/tax-server';
import { daysUntil } from '@/lib/tax';
import { SUPER_ADMINS } from '@/lib/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

const WINDOWS = [30, 7]; // days before due date

export async function sweepTaxReminders(
  db: Client,
  send: (args: { adminEmails: string[]; quarter: number; dueDate: string; amountCents: number; daysOut: number }) => Promise<void>,
  now: Date = new Date(),
): Promise<{ fired: number; window: number | null }> {
  const todayIso = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const est = await computeEstimates(db, year);
  if (!est || !est.reviewed) return { fired: 0, window: null }; // dormant until CPA review

  let fired = 0; let firedWindow: number | null = null;
  for (const q of est.quarters) {
    if (!q.dueDate) continue;
    const out = daysUntil(q.dueDate, todayIso);
    // Fire on the day we cross into a window (out === 30 or === 7).
    const hit = WINDOWS.find((w) => out === w);
    if (hit == null) continue;

    // Dedup: record fired windows in the snapshot's assumptions.
    const { data: snap } = await db.from('tax_estimate_snapshots')
      .select('id,assumptions').eq('tax_year', year).eq('quarter', q.quarter).is('studio_id', null).maybeSingle();
    const reminders: number[] = ((snap as any)?.assumptions?.reminders as number[]) ?? [];
    if (reminders.includes(hit)) continue;

    const { data: profs } = await db.from('profiles').select('email').in('email', SUPER_ADMINS as unknown as string[]);
    const adminEmails = ((profs ?? []) as any[]).map((p) => p.email).filter(Boolean);
    if (adminEmails.length === 0) continue;

    await send({ adminEmails, quarter: q.quarter, dueDate: q.dueDate, amountCents: q.suggestedPaymentCents, daysOut: hit });

    await db.from('tax_estimate_snapshots').upsert({
      studio_id: null, tax_year: year, quarter: q.quarter,
      ytd_net_cents: q.ytdNetCents, se_tax_cents: q.seTaxCents,
      income_tax_cents: q.incomeTaxCents, suggested_payment_cents: q.suggestedPaymentCents,
      assumptions: { ...((snap as any)?.assumptions ?? {}), reminders: [...reminders, hit] },
      computed_at: new Date().toISOString(),
    } as never, { onConflict: 'studio_id,tax_year,quarter' });
    fired++; firedWindow = hit;
  }
  return { fired, window: firedWindow };
}
