'use client';

// components/admin/TaxCenter.tsx — admin Tax Center (Plan 5 + owner-audit fixes).
// Preparation + organization, NOT tax advice. Tabs: Home (estimates + payments
// + P&L + CPA packet), Expenses (+ recurring), Contractors (1099 compliance,
// W-9 upload/download, edit form), Lessons.
//
// YEAR is selectable (current + 2 prior) — January's work is about LAST year;
// in January the selector defaults to the prior year for exactly that reason.

import { useCallback, useEffect, useState } from 'react';
import {
  Download, FileSpreadsheet, AlertTriangle, Check,
  ChevronDown, Receipt, Users, GraduationCap, Calculator,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { TAX_DISCLAIMER, daysUntil } from '@/lib/tax';
import { TAX_LESSONS } from '@/lib/tax-lessons';
import TaxExpenses from './TaxExpenses';

type Tab = 'home' | 'expenses' | 'contractors' | 'lessons';
const NOW = new Date();
const CURRENT_YEAR = NOW.getUTCFullYear();
// January–February default to the PRIOR year: 1099s + the CPA packet are about
// the year that just ended (the audit's headline finding).
const DEFAULT_YEAR = NOW.getUTCMonth() < 2 ? CURRENT_YEAR - 1 : CURRENT_YEAR;
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const Disclaimer = () => (
  <p className="font-mono text-[10px] text-black/40 italic mb-4 border-l-2 border-accent/40 pl-2">{TAX_DISCLAIMER}</p>
);

async function openSignedFile(query: string) {
  try {
    const res = await fetch(`/api/admin/tax/file?${query}`);
    const j = await res.json();
    if (res.ok && j.url) window.open(j.url, '_blank', 'noopener');
    else alert(j.error || 'No file on record');
  } catch { alert('Could not open the file'); }
}

export default function TaxCenter() {
  const [tab, setTab] = useState<Tab>('home');
  const [year, setYear] = useState(DEFAULT_YEAR);
  const tabs: { key: Tab; label: string; icon: typeof Calculator }[] = [
    { key: 'home', label: 'Home', icon: Calculator },
    { key: 'expenses', label: 'Expenses', icon: Receipt },
    { key: 'contractors', label: 'Contractors', icon: Users },
    { key: 'lessons', label: 'Learn', icon: GraduationCap },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h2 className="text-heading-md">TAX CENTER</h2>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="border-2 border-black/15 px-2 py-1 font-mono text-xs font-bold focus:border-accent focus:outline-none">
          {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {year !== CURRENT_YEAR && (
          <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-accent/20 text-black/70">viewing {year}</span>
        )}
      </div>
      <Disclaimer />
      <div className="flex gap-0 border-b border-black/10 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 border-b-2 transition-colors inline-flex items-center gap-1.5 flex-shrink-0 ${
              tab === t.key ? 'border-accent text-black' : 'border-transparent text-black/40 hover:text-black/70'
            }`}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'home' && <HomeTab year={year} />}
      {tab === 'expenses' && <ExpensesTab year={year} />}
      {tab === 'contractors' && <ContractorsTab year={year} />}
      {tab === 'lessons' && <LessonsTab onNavigate={setTab} />}
    </div>
  );
}

// ── Home: estimates + actual payments + P&L summary + CPA packet ─────────────

interface Quarter {
  quarter: number; dueDate: string | null; ytdNetCents: number; seTaxCents: number;
  qbiDeductionCents: number; incomeTaxCents: number; suggestedPaymentCents: number;
  paidCents: number | null; paidOn: string | null;
}
interface PnLData {
  totalRevenueCents: number; totalExpensesCents: number; contractLaborCents: number; netProfitCents: number;
  deductibleExpensesCents: number; nondeductibleCents: number;
  equipmentInvestedCents: number; equipmentDeductionCents: number;
  expensesByCategory: { key: string; label: string; scheduleCLine: string; amountCents: number; deductiblePct: number; deductibleCents: number }[];
}

function HomeTab({ year }: { year: number }) {
  const [est, setEst] = useState<{ available: boolean; reviewed?: boolean; applyQbi?: boolean; entityNote?: string; owesSeTax?: boolean; currentQuarter?: number; quarters?: Quarter[]; message?: string } | null>(null);
  const [pnl, setPnl] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [payQ, setPayQ] = useState<Quarter | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', paid_on: new Date().toISOString().slice(0, 10), confirmation: '' });
  const [payBusy, setPayBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, p] = await Promise.all([
        fetch(`/api/admin/tax/estimates?year=${year}`).then((r) => r.json()),
        fetch(`/api/admin/tax/pnl?year=${year}`).then((r) => r.json()),
      ]);
      setEst(e); setPnl(p.pnl);
    } catch { /* ignore */ }
    setLoading(false);
  }, [year]);
  useEffect(() => { load(); }, [load]);

  async function recordPayment() {
    if (!payQ) return;
    const cents = Math.round(parseFloat(payForm.amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) { alert('Enter a valid amount'); return; }
    setPayBusy(true);
    try {
      const res = await fetch('/api/admin/tax/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_year: year, quarter: payQ.quarter, paid_cents: cents, paid_on: payForm.paid_on, confirmation: payForm.confirmation }),
      });
      const j = await res.json();
      if (!res.ok) alert(j.error || 'Save failed');
      else { setPayQ(null); await load(); }
    } catch { alert('Network error'); }
    setPayBusy(false);
  }

  if (loading) return <p className="font-mono text-sm text-black/40">Loading…</p>;

  const cur = est?.quarters?.find((q) => q.quarter === est.currentQuarter);
  const todayIso = new Date().toISOString().slice(0, 10);
  const weeksLeft = cur?.dueDate ? Math.max(1, Math.ceil(daysUntil(cur.dueDate, todayIso) / 7)) : null;

  return (
    <div className="space-y-6">
      {/* Current-quarter set-aside */}
      <div className="border-2 border-black/10 p-5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">
          {year === CURRENT_YEAR ? 'This quarter — suggested set-aside' : `${year} — suggested set-aside (historical)`}
        </p>
        {!est?.available ? (
          <p className="font-mono text-sm text-black/50">{est?.message || 'Not configured yet.'}</p>
        ) : (
          <>
            {!est.reviewed && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 px-3 py-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="font-mono text-[11px] text-amber-800">Draft figures — your accountant reviews the tax tables before these are final.</span>
              </div>
            )}
            <p className="font-heading text-3xl">{cur ? formatCents(cur.suggestedPaymentCents) : '—'}</p>
            <p className="font-mono text-xs text-black/50 mt-1">
              Q{est.currentQuarter}{cur?.dueDate ? ` · due ${cur.dueDate}` : ''}
              {est.owesSeTax && cur ? ` · incl. ${formatCents(cur.seTaxCents)} self-employment tax` : ''}
            </p>
            {cur && cur.suggestedPaymentCents > 0 && weeksLeft && (
              <p className="font-mono text-[11px] text-black/40 mt-1">
                ≈ {formatCents(Math.ceil(cur.suggestedPaymentCents / weeksLeft))} set aside per week until the due date.
              </p>
            )}
            {cur && cur.suggestedPaymentCents === 0 && (
              <p className="font-mono text-[11px] text-black/40 mt-1">
                $0 means your year-to-date liability is already covered by earlier quarters — if income dropped, you may even be ahead. Worth a word with your accountant.
              </p>
            )}
            {est.entityNote && <p className="font-mono text-[11px] text-black/40 mt-2">{est.entityNote}</p>}
          </>
        )}
      </div>

      {/* Four-quarter table with actual payments */}
      {est?.available && est.quarters && (
        <div className="border-2 border-black/10 p-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-3">{year} quarterly estimates · suggested vs what you actually paid</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead><tr className="font-mono text-[10px] text-black/50 uppercase tracking-wider text-left">
                <th className="py-1">Quarter</th><th>Due</th><th className="text-right" title="Revenue minus DEDUCTIBLE expenses — matches the P&L card's deductible figure, not cash net">YTD taxable net</th>{est.owesSeTax && <th className="text-right">SE tax</th>}<th className="text-right">Suggested</th><th className="text-right">Paid</th><th></th>
              </tr></thead>
              <tbody className="font-mono text-sm">
                {est.quarters.map((q) => (
                  <tr key={q.quarter} className={`border-t border-black/5 ${q.quarter === est.currentQuarter && year === CURRENT_YEAR ? 'bg-accent/5' : ''}`}>
                    <td className="py-1.5 font-bold">Q{q.quarter}</td><td className="text-black/60">{q.dueDate || '—'}</td>
                    <td className="text-right">{formatCents(q.ytdNetCents)}</td>
                    {est.owesSeTax && <td className="text-right">{formatCents(q.seTaxCents)}</td>}
                    <td className="text-right font-bold">
                      {formatCents(q.suggestedPaymentCents)}
                      {q.qbiDeductionCents > 0 && (
                        <span className="block font-mono text-[9px] font-normal text-black/40">QBI −{formatCents(q.qbiDeductionCents)}</span>
                      )}
                    </td>
                    <td className="text-right">{q.paidCents != null
                      ? <span className="text-green-700 font-bold">{formatCents(q.paidCents)}</span>
                      : <span className="text-black/30">—</span>}</td>
                    <td className="text-right">
                      <button onClick={() => { setPayQ(q); setPayForm({ amount: ((q.paidCents ?? q.suggestedPaymentCents) / 100).toFixed(2), paid_on: new Date().toISOString().slice(0, 10), confirmation: '' }); }}
                        className="font-mono text-[10px] underline text-black/50 hover:text-black">
                        {q.paidCents != null ? 'add' : 'record payment'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-[10px] text-black/40 mt-2">Recorded payments feed the next quarter&apos;s math — pay more, owe less later.</p>
          {est.applyQbi === false && (
            <p className="font-mono text-[10px] text-amber-700 mt-1">QBI deduction OFF (Tax Profile setting) — estimates exclude the 20% deduction.</p>
          )}
        </div>
      )}

      {/* Record-payment inline form */}
      {payQ && (
        <div className="border-2 border-accent p-4">
          <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3">Record Q{payQ.quarter} {year} estimated payment</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <input inputMode="decimal" placeholder="Amount $" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
            <input type="date" value={payForm.paid_on} onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
            <input placeholder="Confirmation # (optional)" value={payForm.confirmation} onChange={(e) => setPayForm({ ...payForm, confirmation: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none md:col-span-2" />
          </div>
          <div className="flex gap-2">
            <button onClick={recordPayment} disabled={payBusy} className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 disabled:opacity-50">{payBusy ? 'Saving…' : 'Save payment'}</button>
            <button onClick={() => setPayQ(null)} className="font-mono text-xs text-black/50 hover:text-black px-2">Cancel</button>
          </div>
        </div>
      )}

      {/* P&L summary */}
      {pnl && (
        <div className="border-2 border-black/10 p-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-3">{year} profit &amp; loss</p>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div><p className="font-heading text-xl">{formatCents(pnl.totalRevenueCents)}</p><p className="font-mono text-[10px] text-black/50 uppercase">Revenue</p></div>
            <div><p className="font-heading text-xl">{formatCents(pnl.totalExpensesCents)}</p><p className="font-mono text-[10px] text-black/50 uppercase">Expenses</p></div>
            <div><p className={`font-heading text-xl ${pnl.netProfitCents >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCents(pnl.netProfitCents)}</p><p className="font-mono text-[10px] text-black/50 uppercase">Net profit</p></div>
          </div>
          {pnl.nondeductibleCents > 0 && (
            <p className="font-mono text-[11px] text-black/60 mb-2">
              Deductible {formatCents(pnl.deductibleExpensesCents)} · Non-deductible {formatCents(pnl.nondeductibleCents)} (entertainment/staff meals — logged, not deducted)
            </p>
          )}
          <p className="font-mono text-[10px] text-black/40">Contract labor auto-filled from the payroll engine (staff earnings for the year&apos;s work): {formatCents(pnl.contractLaborCents)} — don&apos;t enter payouts as expenses.</p>
        </div>
      )}

      {/* Equipment headline — OBBBA: 100% bonus depreciation is permanent */}
      {pnl && pnl.equipmentInvestedCents > 0 && (
        <div className="border-2 border-black/10 p-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">Equipment — first-year expensing</p>
          <p className="font-mono text-sm">
            Equipment invested {year}: <span className="font-bold">{formatCents(pnl.equipmentInvestedCents)}</span>
            {' '}→ full first-year write-off candidate: <span className="font-bold">{formatCents(pnl.equipmentDeductionCents)}</span>
          </p>
          <p className="font-mono text-[10px] text-black/40 mt-1">100% bonus depreciation is permanent — your CPA elects bonus vs Section 179.</p>
        </div>
      )}

      {/* CPA packet */}
      <div className="border-2 border-black p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-mono text-sm font-bold uppercase tracking-wider flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-accent" /> Hand your accountant one file</p>
          <p className="font-mono text-[11px] text-black/50 mt-1">{year} packet: P&amp;L, expense detail, contractors, equipment, revenue, assumptions.</p>
        </div>
        <a href={`/api/admin/tax/packet?year=${year}`}
          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 inline-flex items-center gap-2">
          <Download className="w-4 h-4" /> Download {year} packet
        </a>
      </div>
    </div>
  );
}

// ── Expenses — the shared TaxExpenses surface (also embedded in Accounting's
// Profit view; one system, two doors) ────────────────────────────────────────

function ExpensesTab({ year }: { year: number }) {
  return <TaxExpenses from={`${year}-01-01`} to={`${year}-12-31`} />;
}

// ── Contractors (1099 compliance + edit + W-9) ───────────────────────────────

interface Card {
  id: string; legalName: string; displayName: string; businessName: string | null;
  hasW9: boolean; tinLast4: string | null; w9StoragePath: string | null;
  ytdPaidCents: number; needs1099: boolean; flag: string; cashCents: number;
  isOwner: boolean; filed1099On: string | null;
  addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; zip: string | null;
  entityType: string | null;
  thresholdCents: number | null; voluntary1099: boolean;
}

function ContractorsTab({ year }: { year: number }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [routeThreshold, setRouteThreshold] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/tax/contractors?year=${year}`);
      const j = await r.json();
      if (r.ok) { setCards(j.contractors); setRouteThreshold(j.thresholdCents ?? null); }
    } catch { /* ignore */ }
    setLoading(false);
  }, [year]);
  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/admin/tax/contractors/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) alert((await res.json()).error || 'Save failed');
    await load();
    setBusy(false);
  }

  async function uploadW9(id: string, file: File) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tax/expenses/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, kind: 'w9' }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Upload failed'); setBusy(false); return; }
      const put = await fetch(data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!put.ok) { alert('Upload failed'); setBusy(false); return; }
      await patch(id, { w9_storage_path: data.filePath });
    } catch { alert('Upload error'); setBusy(false); }
  }

  async function addContractor() {
    if (!newName.trim()) return;
    const res = await fetch('/api/admin/tax/contractors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legal_name: newName.trim() }),
    });
    if (!res.ok) alert((await res.json()).error || 'Save failed');
    setNewName('');
    await load();
  }

  function saveEdit(id: string) {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edit)) body[k] = v;
    if (Object.keys(body).length === 0) return;
    setEdit({});
    patch(id, body);
  }

  if (loading) return <p className="font-mono text-sm text-black/40">Loading…</p>;
  const noConstants = cards.some((c) => c.flag === 'no_constants');
  const need = cards.filter((c) => c.needs1099).length;
  const missingW9 = cards.filter((c) => c.flag === 'needs_1099_missing_w9').length;
  const thresholdCents = routeThreshold ?? cards[0]?.thresholdCents ?? null;
  const inputCls = 'border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none';

  return (
    <div className="space-y-4">
      {noConstants && (
        <div className="flex items-center gap-2 bg-red-50 border-2 border-red-300 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span className="font-mono text-[11px] text-red-700">
            Tax tables for {year} aren&apos;t configured — 1099 status is UNKNOWN for every contractor (not &quot;under $600&quot;). Ask your accountant to confirm the year&apos;s figures.
          </span>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="border border-black/10 px-4 py-2"><span className="font-heading text-xl">{need}</span><span className="font-mono text-[10px] text-black/50 uppercase tracking-wider ml-2">need a 1099</span></div>
        {missingW9 > 0 && <div className="border border-red-300 bg-red-50 px-4 py-2"><span className="font-heading text-xl text-red-600">{missingW9}</span><span className="font-mono text-[10px] text-red-600 uppercase tracking-wider ml-2">missing W-9</span></div>}
        <a href={`/api/admin/tax/contractors/export-1099?year=${year}`} className="ml-auto border-2 border-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black hover:text-white inline-flex items-center gap-2">
          <Download className="w-3.5 h-3.5" /> 1099 CSV ({year})
        </a>
      </div>
      <p className="font-mono text-[10px] text-black/40">
        A 1099-NEC is required (by Jan 31) for anyone paid {thresholdCents != null ? `${formatCents(thresholdCents)}+ in ${year}` : `— threshold unknown for ${year}; tax tables not configured`}. Cash counts. Click a contractor to fill in their W-9 details for the export.
      </p>
      <p className="font-mono text-[10px] text-black/40">
        The income is still taxable to them and the expense still deductible to you — the form requirement changed, not the tax.
      </p>

      <div className="flex gap-2">
        <input placeholder="Add a contractor paid outside payroll…" value={newName} onChange={(e) => setNewName(e.target.value)} className={`${inputCls} flex-1`} />
        <button onClick={addContractor} className="bg-black text-white font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5">Add</button>
      </div>

      {cards.length === 0 ? <p className="font-mono text-xs text-black/40 border-2 border-dashed border-black/10 p-6 text-center">No contractors recorded.</p> : (
        <div className="space-y-2">
          {cards.map((c) => (
            <div key={c.id} className={`border-2 ${c.flag === 'needs_1099_missing_w9' ? 'border-red-300 bg-red-50/40' : c.needs1099 ? 'border-accent/50' : 'border-black/10'}`}>
              <button onClick={() => { setOpenId(openId === c.id ? null : c.id); setEdit({}); }} className="w-full text-left p-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm font-bold">{c.displayName}</span>
                  {c.isOwner && <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-black text-white">Owner</span>}
                  {c.businessName && <span className="font-mono text-[10px] text-black/40">{c.businessName}</span>}
                  <span className="font-mono text-sm ml-auto">{formatCents(c.ytdPaidCents)} <span className="text-black/40 text-[10px]">{year}</span></span>
                  {c.cashCents > 0 && <span className="font-mono text-[10px] text-black/40">({formatCents(c.cashCents)} cash)</span>}
                  <ChevronDown className={`w-4 h-4 text-black/30 transition-transform ${openId === c.id ? 'rotate-180' : ''}`} />
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {c.flag === 'owner' ? <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-black/5 text-black/50">owner pay — never 1099</span>
                    : c.flag === 'no_constants' ? <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-red-100 text-red-700">1099 status unknown</span>
                    : c.needs1099
                      ? <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 bg-accent text-black">1099-NEC required</span>
                      : <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-black/5 text-black/40">
                          {c.thresholdCents != null
                            ? `No 1099 required at current total (${formatCents(c.ytdPaidCents)} of ${formatCents(c.thresholdCents)})`
                            : 'under $600'}
                        </span>}
                  {!c.isOwner && (c.hasW9
                    ? <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-green-100 text-green-700 inline-flex items-center gap-1"><Check className="w-3 h-3" /> W-9 on file</span>
                    : <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-red-100 text-red-700">No W-9</span>)}
                  {c.tinLast4 && <span className="font-mono text-[10px] text-black/40">TIN …{c.tinLast4}</span>}
                  {c.filed1099On && <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-green-100 text-green-700">1099 filed {c.filed1099On}</span>}
                </div>
              </button>

              {openId === c.id && (
                <div className="border-t border-black/10 p-3 space-y-3 bg-black/[0.015]">
                  {/* W-9 details for the 1099 export */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <input placeholder="Legal name (as on W-9)" defaultValue={c.legalName} onChange={(e) => setEdit({ ...edit, legal_name: e.target.value })} className={inputCls} />
                    <input placeholder="Business name" defaultValue={c.businessName ?? ''} onChange={(e) => setEdit({ ...edit, business_name: e.target.value })} className={inputCls} />
                    <input placeholder="TIN (stored as last 4 only)" onChange={(e) => setEdit({ ...edit, tin: e.target.value })} className={inputCls} />
                    <input placeholder="Address line 1" defaultValue={c.addressLine1 ?? ''} onChange={(e) => setEdit({ ...edit, address_line1: e.target.value })} className={inputCls} />
                    <input placeholder="City" defaultValue={c.city ?? ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} className={inputCls} />
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder="State" maxLength={2} defaultValue={c.state ?? ''} onChange={(e) => setEdit({ ...edit, state: e.target.value.toUpperCase() })} className={inputCls} />
                      <input placeholder="ZIP" defaultValue={c.zip ?? ''} onChange={(e) => setEdit({ ...edit, zip: e.target.value })} className={inputCls} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => saveEdit(c.id)} disabled={busy || Object.keys(edit).length === 0}
                      className="bg-black text-white font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 disabled:opacity-40">Save details</button>
                    <label className="font-mono text-[10px] text-black/50 cursor-pointer hover:text-black underline">
                      <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadW9(c.id, e.target.files[0])} />
                      {c.w9StoragePath ? 'Replace W-9 PDF' : 'Upload W-9 PDF'}
                    </label>
                    {c.w9StoragePath && (
                      <button onClick={() => openSignedFile(`contractor=${c.id}`)} className="font-mono text-[10px] underline text-black/50 hover:text-black">View W-9</button>
                    )}
                    {!c.w9StoragePath && (
                      <button onClick={() => patch(c.id, { w9_received: !c.hasW9 })} className="font-mono text-[10px] underline text-black/50 hover:text-black">
                        {c.hasW9 ? 'Clear W-9 (paper)' : 'Mark W-9 received (paper)'}
                      </button>
                    )}
                    <label className="font-mono text-[10px] text-black/50 inline-flex items-center gap-1 ml-auto">
                      <input type="checkbox" checked={c.isOwner} onChange={(e) => patch(c.id, { is_owner: e.target.checked })} />
                      Owner pay (never 1099 / excluded from contract labor)
                    </label>
                    {c.needs1099 && !c.filed1099On && (
                      <button onClick={() => patch(c.id, { mark_1099_filed: year })} className="font-mono text-[10px] font-bold underline text-green-700 hover:text-green-900">
                        Mark 1099 filed for {year}
                      </button>
                    )}
                    {c.filed1099On && (
                      <button onClick={() => patch(c.id, { mark_1099_filed: year, unfile: true })} className="font-mono text-[10px] underline text-black/40 hover:text-black">
                        Un-file {year}
                      </button>
                    )}
                  </div>
                  {!c.isOwner && (
                    <div>
                      <label className="font-mono text-[10px] text-black/50 inline-flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={c.voluntary1099} onChange={(e) => patch(c.id, { voluntary_1099: e.target.checked })} disabled={busy} />
                        Voluntary 1099
                      </label>
                      <p className="font-mono text-[10px] text-black/40 mt-0.5">Issue below threshold anyway — some studios prefer complete paper trails. Included in the CSV when on.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lessons ──────────────────────────────────────────────────────────────────

function LessonsTab({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const [open, setOpen] = useState<string | null>(TAX_LESSONS[0]?.id ?? null);
  return (
    <div className="space-y-2">
      {TAX_LESSONS.map((l) => (
        <div key={l.id} className="border-2 border-black/10">
          <button onClick={() => setOpen(open === l.id ? null : l.id)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-black/[0.02]">
            <span className="font-mono text-sm font-bold">{l.title}</span>
            <ChevronDown className={`w-4 h-4 text-black/40 transition-transform ${open === l.id ? 'rotate-180' : ''}`} />
          </button>
          {open === l.id && (
            <div className="px-4 pb-4 space-y-2">
              {l.body.map((para, i) => <p key={i} className="font-mono text-xs text-black/70 leading-relaxed">{para}</p>)}
              {l.linksTo && (
                <button onClick={() => onNavigate(l.linksTo!.tab as Tab)} className="font-mono text-[11px] font-bold text-accent underline hover:text-accent/80">
                  {l.linksTo.label} →
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
