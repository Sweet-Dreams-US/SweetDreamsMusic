// GET /api/admin/tax/pnl?year= — the year P&L (revenue streams, expenses by
// category w/ IRS line, contract labor auto-fed, net). Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { computePnL } from '@/lib/tax-server';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getUTCFullYear();
  return NextResponse.json({ pnl: await computePnL(createServiceClient(), year) });
}
