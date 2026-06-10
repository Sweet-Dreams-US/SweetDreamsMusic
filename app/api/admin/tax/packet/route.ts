// GET /api/admin/tax/packet?year= — the year-end CPA packet (Plan 5 Phase 5).
// One .xlsx, six tabs. "Hand your accountant one file." Admin only.

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { computePnL, listExpenses, contractorDashboard, getTaxProfile, getTaxConstants } from '@/lib/tax-server';
import { TAX_DISCLAIMER, EXPENSE_CATEGORIES, ENTITY_TYPES } from '@/lib/tax';

export const maxDuration = 60;

const usd = (cents: number) => Number((cents / 100).toFixed(2));

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getUTCFullYear();
  const db = createServiceClient();
  const from = `${year}-01-01`, to = `${year}-12-31`;

  const [pnl, profile, expenses, contractors, constants] = await Promise.all([
    computePnL(db, year), getTaxProfile(db), listExpenses(db, from, to),
    contractorDashboard(db, year), getTaxConstants(db, year),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sweet Dreams Music — Tax Center';
  wb.created = new Date();
  const catLabel = (k: string) => EXPENSE_CATEGORIES.find((c) => c.key === k)?.label ?? k;
  const catLine = (k: string) => EXPENSE_CATEGORIES.find((c) => c.key === k)?.scheduleCLine ?? '';
  const head = (ws: ExcelJS.Worksheet, cols: string[]) => {
    const r = ws.addRow(cols); r.font = { bold: true }; r.eachCell((c) => { c.border = { bottom: { style: 'thin' } }; });
  };

  // 1. P&L summary (revenue streams + expense categories + net).
  const pnlWs = wb.addWorksheet('P&L');
  pnlWs.addRow([`Profit & Loss — ${year}`]).font = { bold: true, size: 14 };
  pnlWs.addRow([TAX_DISCLAIMER]).font = { italic: true, color: { argb: 'FF888888' } };
  pnlWs.addRow([]);
  head(pnlWs, ['Revenue stream', 'Amount (USD)']);
  pnlWs.addRow(['Studio sessions', usd(pnl.revenue.sessionsCents)]);
  pnlWs.addRow(['Beat sales', usd(pnl.revenue.beatsCents)]);
  pnlWs.addRow(['Media sales', usd(pnl.revenue.mediaSalesCents)]);
  pnlWs.addRow(['Kept deposits (cancellations)', usd(pnl.revenue.keptDepositsCents)]);
  pnlWs.addRow(['Total revenue', usd(pnl.totalRevenueCents)]).font = { bold: true };
  pnlWs.addRow([]);
  head(pnlWs, ['Expense category', 'IRS Schedule C line', 'Amount (USD)']);
  for (const c of pnl.expensesByCategory) pnlWs.addRow([c.label, c.scheduleCLine, usd(c.amountCents)]);
  pnlWs.addRow(['Total expenses', '', usd(pnl.totalExpensesCents)]).font = { bold: true };
  pnlWs.addRow([]);
  pnlWs.addRow(['NET PROFIT', '', usd(pnl.netProfitCents)]).font = { bold: true, size: 12 };
  pnlWs.columns.forEach((c) => { c.width = 32; });

  // 2. Expense detail (every row + receipt indicator).
  const expWs = wb.addWorksheet('Expense Detail');
  head(expWs, ['Date', 'Category', 'Schedule C line', 'Vendor', 'Description', 'Amount (USD)', 'Equipment?', 'Receipt on file']);
  for (const e of expenses) {
    expWs.addRow([e.incurredOn, catLabel(e.category), catLine(e.category), e.vendor ?? '', e.description, usd(e.amountCents), e.isEquipment ? 'Yes' : '', e.receiptStoragePath ? 'Yes' : '']);
  }
  expWs.columns.forEach((c, i) => { c.width = [12, 22, 18, 20, 34, 14, 11, 14][i] ?? 18; });

  // 3. Contractor summary (1099 readiness).
  const conWs = wb.addWorksheet('Contractors');
  head(conWs, ['Legal name', 'Business name', 'TIN (last 4)', 'Total paid (USD)', 'Of which cash (USD)', 'W-9 on file', '1099-NEC required']);
  for (const c of contractors) {
    conWs.addRow([c.legalName, c.businessName ?? '', c.tinLast4 ? `…${c.tinLast4}` : '', usd(c.ytdPaidCents), usd(c.cashCents), c.hasW9 ? 'Yes' : 'No', c.needs1099 ? 'YES' : '']);
  }
  conWs.columns.forEach((c, i) => { c.width = [26, 24, 12, 16, 18, 12, 18][i] ?? 18; });

  // 4. Equipment (Section 179 candidates).
  const eqWs = wb.addWorksheet('Equipment (Sec 179)');
  head(eqWs, ['Date', 'Vendor', 'Description', 'Amount (USD)']);
  for (const e of expenses.filter((x) => x.isEquipment || x.category === 'equipment')) {
    eqWs.addRow([e.incurredOn, e.vendor ?? '', e.description, usd(e.amountCents)]);
  }
  eqWs.columns.forEach((c, i) => { c.width = [12, 22, 40, 14][i] ?? 18; });

  // 5. Revenue detail by stream (the headline streams, labeled).
  const revWs = wb.addWorksheet('Revenue Detail');
  head(revWs, ['Stream', 'Amount (USD)', 'Note']);
  revWs.addRow(['Studio sessions', usd(pnl.revenue.sessionsCents), 'Non-cancelled bookings, by session date']);
  revWs.addRow(['Beat sales', usd(pnl.revenue.beatsCents), 'beat_purchases amount paid, by purchase date']);
  revWs.addRow(['Media sales', usd(pnl.revenue.mediaSalesCents), 'media_sales, by sale date']);
  revWs.addRow(['Kept deposits', usd(pnl.revenue.keptDepositsCents), 'Deposits retained on cancellations']);
  revWs.addRow(['Hub media deposits collected', usd(pnl.revenue.hubMediaCents), 'Deposits only (not full order value) — reference line, confirm overlap with your CPA']);
  revWs.columns.forEach((c, i) => { c.width = [30, 16, 48][i] ?? 18; });

  // 6. Assumptions.
  const asmWs = wb.addWorksheet('Assumptions');
  const entityLabel = ENTITY_TYPES.find((e) => e.value === profile.entityType)?.label ?? profile.entityType;
  asmWs.addRow(['Assumptions & basis']).font = { bold: true, size: 14 };
  asmWs.addRow([TAX_DISCLAIMER]).font = { italic: true, color: { argb: 'FF888888' } };
  asmWs.addRow([]);
  [
    ['Tax year', String(year)],
    ['Entity type', entityLabel],
    ['Est. income tax rate', `${profile.estimatedIncomeTaxRatePct}%`],
    ['EIN (last 4)', profile.einLast4 ? `…${profile.einLast4}` : '—'],
    ['State', profile.state ?? '—'],
    ['Contract labor basis', 'Actual payouts recorded (all methods incl. cash); owner-marked payees excluded. Cash basis — unpaid year-end balances owed to staff are NOT included; see the Accounting payroll tab.'],
    ['Revenue basis', 'Sessions by session date; beats/media by transaction date; GROSS of refunds and card-processing fees (log fees as Merchant/Processing Fees expenses)'],
    ['Sales tax', 'NOT computed or collected by this system (deliberate) — confirm state obligations with your CPA'],
    ['Not tracked here — bring separately', 'Vehicle mileage, home office, owner health insurance, retirement contributions, owner draws'],
    ['Equipment tab note', 'Equipment rows also appear in the expense totals above — they are flagged for Section 179 review, not double-counted'],
    ['Meals note', 'Meals are recorded at full amount; the 50% limitation is applied by your preparer'],
    ['Tax constants reviewed by CPA', constants?.reviewed ? 'Yes' : 'NO — figures are drafts pending review'],
    ['Generated', new Date().toISOString()],
  ].forEach((r) => asmWs.addRow(r));
  asmWs.columns.forEach((c, i) => { c.width = [32, 60][i] ?? 18; });

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="CPA-packet-${year}.xlsx"`,
    },
  });
}
