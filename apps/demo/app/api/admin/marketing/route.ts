import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { getMarketingSnapshot, type MarketingRangeDays } from '@/lib/meta-marketing';

// GET /api/admin/marketing?days=7|28|90 — the Marketing tab's data source.
// Returns (a) the Sweet-Dreams-only Meta ads snapshot (shared ad account is
// filtered to ads promoting our page/IG — see lib/meta-marketing.ts) and
// (b) COLLECTED business revenue for the same window, so the UI can show true
// ROAS: what the studio actually banked per ad dollar.
//
// Revenue definition (collected basis, matching the Accounting panel's intent):
//   • completed studio sessions      — bookings.total_amount, start_time in window
//   • beat sales                     — beat_purchases.amount_paid, created_at in window
//   • media contract installments    — media_payment_installments PAID, paid_at in window
//   • legacy media sales             — media_sales.amount, created_at in window
// (Package sales are excluded for now — no clean per-window collected stamp.)
// All figures in CENTS; Meta spend arrives in dollars and is passed through.

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const daysRaw = new URL(request.url).searchParams.get('days');
  const days: MarketingRangeDays = daysRaw === '7' ? 7 : daysRaw === '90' ? 90 : 28;

  // Ads snapshot (10-min cached in the lib). If Meta is unreachable, surface
  // the error but keep the shape stable so the UI can render a message.
  let ads;
  try {
    ads = await getMarketingSnapshot(days);
  } catch (e) {
    console.error('[admin/marketing] Meta snapshot failed:', e);
    return NextResponse.json({ error: 'Could not load Meta ads data' }, { status: 502 });
  }

  // Window for revenue = the exact dates Meta reported on (account-timezone
  // days, e.g. 2026-06-08 → 2026-07-05), so both sides of the ROAS compare
  // cover the same calendar span.
  const from = ads.since;
  const to = ads.until;

  // Financial tables have owner-only RLS (no admin-read policy) → service
  // client, same rationale as /api/admin/accounting.
  const service = createServiceClient();
  const [sessionsQ, beatsQ, instsQ, mediaSalesQ] = await Promise.all([
    service
      .from('bookings')
      .select('total_amount')
      .eq('status', 'completed')
      .gte('start_time', from)
      .lte('start_time', `${to}T23:59:59`),
    service
      .from('beat_purchases')
      .select('amount_paid')
      .gte('created_at', from)
      .lte('created_at', `${to}T23:59:59`),
    service
      .from('media_payment_installments')
      .select('amount_cents')
      .eq('status', 'paid')
      .gte('paid_at', from)
      .lte('paid_at', `${to}T23:59:59`),
    service
      .from('media_sales')
      .select('amount')
      .gte('created_at', from)
      .lte('created_at', `${to}T23:59:59`),
  ]);

  const sum = (rows: unknown[] | null, key: string) =>
    ((rows ?? []) as Array<Record<string, number | null>>).reduce((s, r) => s + (Number(r[key]) || 0), 0);

  const sessionsCents = sum(sessionsQ.data, 'total_amount');
  const beatsCents = sum(beatsQ.data, 'amount_paid');
  const mediaCents = sum(instsQ.data, 'amount_cents') + sum(mediaSalesQ.data, 'amount');
  const totalCents = sessionsCents + beatsCents + mediaCents;

  const revenueDollars = totalCents / 100;
  const roas = ads.totals.spend > 0 ? revenueDollars / ads.totals.spend : null;

  return NextResponse.json({
    ads,
    revenue: { totalCents, sessionsCents, beatsCents, mediaCents, from, to },
    roas,
  });
}
