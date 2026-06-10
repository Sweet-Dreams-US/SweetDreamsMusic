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
  let fired = 0; let firedWindow: number | null = null;

  // Sweep BOTH the current and the previous tax year: Q4's payment is due the
  // following January 15, so its 7-day window lives in the NEXT calendar year
  // (audit finding — the easiest payment to forget structurally never fired).
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
  const est = await computeEstimates(db, year);
  if (!est || !est.reviewed) continue; // dormant until CPA review

  for (const q of est.quarters) {
    if (!q.dueDate) continue;
    const out = daysUntil(q.dueDate, todayIso);
    // Window matching is <= (smallest eligible first), not exact-day: one
    // failed cron run must not lose the window forever. Past-due → skip.
    if (out < 0) continue;
    const hit = [...WINDOWS].sort((a, b) => a - b).find((w) => out <= w);
    if (hit == null) continue;

    // Dedup: record fired windows in the snapshot's assumptions.
    const { data: snap } = await db.from('tax_estimate_snapshots')
      .select('id,assumptions').eq('tax_year', year).eq('quarter', q.quarter).is('studio_id', null).maybeSingle();
    const reminders: number[] = ((snap as any)?.assumptions?.reminders as number[]) ?? [];
    if (reminders.includes(hit)) continue;

    const { data: profs } = await db.from('profiles').select('email').in('email', SUPER_ADMINS as unknown as string[]);
    const adminEmails = ((profs ?? []) as any[]).map((p) => p.email).filter(Boolean);
    if (adminEmails.length === 0) continue;

    // Record the dedup BEFORE sending — a lost reminder costs one nudge, but a
    // sent-but-unrecorded reminder re-fires daily (same lesson as pause emails).
    // onConflict resolves against the UNIQUE NULLS NOT DISTINCT constraint (080).
    const { error: dedupErr } = await db.from('tax_estimate_snapshots').upsert({
      studio_id: null, tax_year: year, quarter: q.quarter,
      ytd_net_cents: q.ytdNetCents, se_tax_cents: q.seTaxCents,
      income_tax_cents: q.incomeTaxCents, suggested_payment_cents: q.suggestedPaymentCents,
      assumptions: { ...((snap as any)?.assumptions ?? {}), reminders: [...reminders, hit] },
      computed_at: new Date().toISOString(),
    } as never, { onConflict: 'studio_id,tax_year,quarter' });
    if (dedupErr) {
      console.error('[tax-reminders] dedup write failed — skipping send:', dedupErr.message);
      continue;
    }

    await send({ adminEmails, quarter: q.quarter, dueDate: q.dueDate, amountCents: q.suggestedPaymentCents, daysOut: out });
    fired++; firedWindow = hit;
  }
  }
  return { fired, window: firedWindow };
}
