// GET /api/admin/tax/pnl?from=&to=  (or ?year=) — the P&L: revenue streams,
// expenses by category w/ IRS line, contract labor auto-fed, net. Admin only.
// from/to (YYYY-MM-DD) serve the Accounting Profit view's period selector;
// year serves the Tax Center + CPA packet.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { computePnL, computePnLRange } from '@/lib/tax-server';

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = params.get('from'), to = params.get('to');
  const db = createServiceClient();
  if (isDate(from) && isDate(to)) {
    return NextResponse.json({ pnl: await computePnLRange(db, from, to) });
  }
  const year = Number(params.get('year')) || new Date().getUTCFullYear();
  return NextResponse.json({ pnl: await computePnL(db, year) });
}
