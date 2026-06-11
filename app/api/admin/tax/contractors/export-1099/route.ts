// GET /api/admin/tax/contractors/export-1099?year= — the January checklist
// export: a CSV of everyone who needs a 1099-NEC (YTD ≥ threshold), in a column
// layout that drops into Track1099 / Tax1099. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { contractorDashboard } from '@/lib/tax-server';

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getUTCFullYear();
  const db = createServiceClient();
  // Required at the payment-year threshold PLUS voluntary issuances (a studio
  // can choose complete paper trails below threshold — export marks them).
  const cards = (await contractorDashboard(db, year)).filter((c) => c.needs1099 || (c.voluntary1099 && c.ytdPaidCents > 0 && !c.isOwner));

  // Pull address/TIN-last4 for the filers (dashboard omits them).
  const ids = cards.map((c) => c.id);
  const { data: details } = ids.length
    ? await db.from('contractors').select('id,legal_name,business_name,address_line1,address_line2,city,state,zip,tin_last4,w9_received_at').in('id', ids)
    : { data: [] };
  const detailById = new Map((details ?? []).map((d: any) => [d.id, d]));

  // Filing basis distinguishes required (over the payment-year threshold) from
  // voluntary below-threshold issuances. Trailing column — e-file importers
  // ignore unknown extras.
  const header = ['Recipient Name', 'Business Name', 'Address 1', 'Address 2', 'City', 'State', 'ZIP', 'TIN (last 4)', 'W-9 on file', 'Box 1 Nonemployee Comp (USD)', 'Filing basis'];
  const rows = cards.map((c) => {
    const d: any = detailById.get(c.id) ?? {};
    return [
      d.legal_name ?? c.legalName, d.business_name ?? c.businessName ?? '',
      d.address_line1 ?? '', d.address_line2 ?? '', d.city ?? '', d.state ?? '', d.zip ?? '',
      d.tin_last4 ? `xxx-xx-${d.tin_last4}` : 'MISSING', d.w9_received_at ? 'YES' : 'NO',
      (c.ytdPaidCents / 100).toFixed(2),
      c.needs1099 ? 'REQUIRED' : 'VOLUNTARY',
    ].map(csvCell).join(',');
  });
  const csv = [header.map(csvCell).join(','), ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="1099-NEC-${year}.csv"`,
    },
  });
}
