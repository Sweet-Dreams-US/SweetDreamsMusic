'use client';

// components/admin/TaxCenter.tsx — admin Tax Center (Plan 5).
// Preparation + organization, NOT tax advice. Internal tabs: Home (estimates +
// P&L + CPA packet), Expenses, Contractors (1099 compliance), Lessons.
// Design mirrors RewardsManager/Accounting: font-mono, border-2 border-black/10.

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, Trash2, Download, FileSpreadsheet, AlertTriangle, Check,
  ChevronDown, Receipt, Users, GraduationCap, Calculator,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { TAX_DISCLAIMER, EXPENSE_CATEGORIES, EQUIPMENT_SUGGEST_CENTS } from '@/lib/tax';
import { TAX_LESSONS } from '@/lib/tax-lessons';

type Tab = 'home' | 'expenses' | 'contractors' | 'lessons';
const YEAR = new Date().getUTCFullYear();

const Disclaimer = () => (
  <p className="font-mono text-[10px] text-black/40 italic mb-4 border-l-2 border-accent/40 pl-2">{TAX_DISCLAIMER}</p>
);

export default function TaxCenter() {
  const [tab, setTab] = useState<Tab>('home');
  const tabs: { key: Tab; label: string; icon: typeof Calculator }[] = [
    { key: 'home', label: 'Home', icon: Calculator },
    { key: 'expenses', label: 'Expenses', icon: Receipt },
    { key: 'contractors', label: 'Contractors', icon: Users },
    { key: 'lessons', label: 'Learn', icon: GraduationCap },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-heading-md">TAX CENTER <span className="font-mono text-xs text-black/40">· {YEAR}</span></h2>
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
      {tab === 'home' && <HomeTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'contractors' && <ContractorsTab />}
      {tab === 'lessons' && <LessonsTab />}
    </div>
  );
}

// ── Home: estimates + P&L summary + CPA packet ───────────────────────────────

interface Quarter { quarter: number; dueDate: string | null; ytdNetCents: number; seTaxCents: number; incomeTaxCents: number; suggestedPaymentCents: number }
interface PnLData { totalRevenueCents: number; totalExpensesCents: number; contractLaborCents: number; netProfitCents: number; expensesByCategory: { key: string; label: string; scheduleCLine: string; amountCents: number }[] }

function HomeTab() {
  const [est, setEst] = useState<{ available: boolean; reviewed?: boolean; entityNote?: string; owesSeTax?: boolean; currentQuarter?: number; quarters?: Quarter[]; message?: string } | null>(null);
  const [pnl, setPnl] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/tax/estimates?year=${YEAR}`).then((r) => r.json()),
      fetch(`/api/admin/tax/pnl?year=${YEAR}`).then((r) => r.json()),
    ]).then(([e, p]) => { setEst(e); setPnl(p.pnl); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="font-mono text-sm text-black/40">Loading…</p>;

  const cur = est?.quarters?.find((q) => q.quarter === est.currentQuarter);
  return (
    <div className="space-y-6">
      {/* Current-quarter set-aside */}
      <div className="border-2 border-black/10 p-5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">This quarter — suggested set-aside</p>
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
            {est.entityNote && <p className="font-mono text-[11px] text-black/40 mt-2">{est.entityNote}</p>}
          </>
        )}
      </div>

      {/* Four-quarter table */}
      {est?.available && est.quarters && (
        <div className="border-2 border-black/10 p-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-3">{YEAR} quarterly estimates (year-to-date basis)</p>
          <table className="w-full">
            <thead><tr className="font-mono text-[10px] text-black/50 uppercase tracking-wider text-left">
              <th className="py-1">Quarter</th><th>Due</th><th className="text-right">YTD net</th>{est.owesSeTax && <th className="text-right">SE tax</th>}<th className="text-right">Income tax</th><th className="text-right">Set aside</th>
            </tr></thead>
            <tbody className="font-mono text-sm">
              {est.quarters.map((q) => (
                <tr key={q.quarter} className={`border-t border-black/5 ${q.quarter === est.currentQuarter ? 'bg-accent/5' : ''}`}>
                  <td className="py-1.5 font-bold">Q{q.quarter}</td><td className="text-black/60">{q.dueDate || '—'}</td>
                  <td className="text-right">{formatCents(q.ytdNetCents)}</td>
                  {est.owesSeTax && <td className="text-right">{formatCents(q.seTaxCents)}</td>}
                  <td className="text-right">{formatCents(q.incomeTaxCents)}</td>
                  <td className="text-right font-bold">{formatCents(q.suggestedPaymentCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* P&L summary */}
      {pnl && (
        <div className="border-2 border-black/10 p-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-3">{YEAR} profit &amp; loss</p>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div><p className="font-heading text-xl">{formatCents(pnl.totalRevenueCents)}</p><p className="font-mono text-[10px] text-black/50 uppercase">Revenue</p></div>
            <div><p className="font-heading text-xl">{formatCents(pnl.totalExpensesCents)}</p><p className="font-mono text-[10px] text-black/50 uppercase">Expenses</p></div>
            <div><p className={`font-heading text-xl ${pnl.netProfitCents >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCents(pnl.netProfitCents)}</p><p className="font-mono text-[10px] text-black/50 uppercase">Net profit</p></div>
          </div>
          <p className="font-mono text-[10px] text-black/40">Contract labor auto-filled from recorded payouts: {formatCents(pnl.contractLaborCents)} — don't enter payouts as expenses.</p>
        </div>
      )}

      {/* CPA packet */}
      <div className="border-2 border-black p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-mono text-sm font-bold uppercase tracking-wider flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-accent" /> Hand your accountant one file</p>
          <p className="font-mono text-[11px] text-black/50 mt-1">Year-end packet: P&amp;L, expense detail, contractors, equipment, revenue, assumptions.</p>
        </div>
        <a href={`/api/admin/tax/packet?year=${YEAR}`}
          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 inline-flex items-center gap-2">
          <Download className="w-4 h-4" /> Download {YEAR} packet
        </a>
      </div>
    </div>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────

interface Expense { id: string; incurredOn: string; amountCents: number; vendor: string | null; category: string; description: string; isEquipment: boolean; receiptStoragePath: string | null }

function ExpensesTab() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ incurred_on: new Date().toISOString().slice(0, 10), amount: '', vendor: '', category: 'supplies', description: '' });
  const [receiptPath, setReceiptPath] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/tax/expenses?year=${YEAR}`);
      const j = await r.json();
      if (r.ok) setExpenses(j.expenses);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function uploadReceipt(file: File) {
    setErr(null);
    try {
      const res = await fetch('/api/admin/tax/expenses/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Upload failed'); return; }
      const put = await fetch(data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!put.ok) { setErr('Upload failed'); return; }
      setReceiptPath(data.filePath);
    } catch { setErr('Upload error'); }
  }

  async function add() {
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setErr('Enter a valid amount'); return; }
    if (!form.description.trim()) { setErr('Description required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/tax/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount_cents: cents, receipt_storage_path: receiptPath }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'Save failed'); setBusy(false); return; }
      setForm({ ...form, amount: '', vendor: '', description: '' }); setReceiptPath(null);
      await load();
    } catch { setErr('Network error'); }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm('Delete this expense?')) return;
    await fetch(`/api/admin/tax/expenses?id=${id}`, { method: 'DELETE' });
    await load();
  }

  const total = expenses.reduce((s, e) => s + e.amountCents, 0);
  return (
    <div className="space-y-5">
      <div className="border-2 border-accent/50 bg-accent/5 p-4">
        <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3">Add expense</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2">
          <input type="date" value={form.incurred_on} onChange={(e) => setForm({ ...form, incurred_on: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
          <input inputMode="decimal" placeholder="Amount $" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none">
            {EXPENSE_CATEGORIES.filter((c) => c.key !== 'contract_labor').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input placeholder="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
          <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none md:col-span-2" />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="font-mono text-[10px] text-black/50 cursor-pointer hover:text-black inline-flex items-center gap-1">
            <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])} />
            <Receipt className="w-3 h-3" /> {receiptPath ? 'Receipt attached ✓' : 'Attach receipt'}
          </label>
          {parseFloat(form.amount) * 100 >= EQUIPMENT_SUGGEST_CENTS && form.category !== 'equipment' && (
            <span className="font-mono text-[10px] text-amber-700">Over $2,500 — consider the Equipment category (Section 179).</span>
          )}
          <button onClick={add} disabled={busy} className="ml-auto bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-1.5 hover:bg-black/80 disabled:opacity-50 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
        {err && <p className="font-mono text-xs text-red-600 mt-2">{err}</p>}
        <p className="font-mono text-[10px] text-black/40 mt-2">Contractor payouts are entered in the Payroll tab — they flow into your P&amp;L automatically. Don&apos;t add them here.</p>
      </div>

      {loading ? <p className="font-mono text-sm text-black/40">Loading…</p> : (
        <div>
          <div className="flex justify-between font-mono text-xs text-black/50 uppercase tracking-wider mb-2">
            <span>{expenses.length} expense{expenses.length === 1 ? '' : 's'} · {YEAR}</span>
            <span>Total {formatCents(total)}</span>
          </div>
          {expenses.length === 0 ? (
            <p className="font-mono text-xs text-black/40 border-2 border-dashed border-black/10 p-6 text-center">No expenses logged yet.</p>
          ) : (
            <div className="space-y-1">
              {expenses.map((e) => {
                const cat = EXPENSE_CATEGORIES.find((c) => c.key === e.category);
                return (
                  <div key={e.id} className="flex items-center gap-3 border border-black/10 px-3 py-2 font-mono text-sm">
                    <span className="text-black/50 text-xs w-20">{e.incurredOn}</span>
                    <span className="flex-1 truncate">{e.description}{e.vendor ? <span className="text-black/40"> · {e.vendor}</span> : ''}</span>
                    <span className="text-[10px] uppercase tracking-wider text-black/40 hidden sm:inline">{cat?.label}{e.isEquipment ? ' · equip' : ''}</span>
                    <span className="font-bold w-24 text-right">{formatCents(e.amountCents)}</span>
                    {e.receiptStoragePath && <Receipt className="w-3 h-3 text-green-600" />}
                    <button onClick={() => remove(e.id)} className="text-black/20 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Contractors (1099 compliance) ────────────────────────────────────────────

interface Card { id: string; legalName: string; displayName: string; businessName: string | null; hasW9: boolean; tinLast4: string | null; ytdPaidCents: number; needs1099: boolean; flag: string; cashCents: number }

function ContractorsTab() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/tax/contractors?year=${YEAR}`);
      const j = await r.json();
      if (r.ok) setCards(j.contractors);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function markW9(id: string, received: boolean) {
    await fetch(`/api/admin/tax/contractors/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ w9_received: received }),
    });
    await load();
  }

  if (loading) return <p className="font-mono text-sm text-black/40">Loading…</p>;
  const need = cards.filter((c) => c.needs1099).length;
  const missingW9 = cards.filter((c) => c.flag === 'needs_1099_missing_w9').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="border border-black/10 px-4 py-2"><span className="font-heading text-xl">{need}</span><span className="font-mono text-[10px] text-black/50 uppercase tracking-wider ml-2">need a 1099</span></div>
        {missingW9 > 0 && <div className="border border-red-300 bg-red-50 px-4 py-2"><span className="font-heading text-xl text-red-600">{missingW9}</span><span className="font-mono text-[10px] text-red-600 uppercase tracking-wider ml-2">missing W-9</span></div>}
        <a href={`/api/admin/tax/contractors/export-1099?year=${YEAR}`} className="ml-auto border-2 border-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black hover:text-white inline-flex items-center gap-2">
          <Download className="w-3.5 h-3.5" /> 1099 CSV
        </a>
      </div>
      <p className="font-mono text-[10px] text-black/40">A 1099-NEC is required (by Jan 31) for anyone paid $600+ in a year. Cash counts. Collect the W-9 before it&apos;s a January scramble.</p>

      {cards.length === 0 ? <p className="font-mono text-xs text-black/40 border-2 border-dashed border-black/10 p-6 text-center">No contractors recorded.</p> : (
        <div className="space-y-2">
          {cards.map((c) => (
            <div key={c.id} className={`border-2 p-3 ${c.flag === 'needs_1099_missing_w9' ? 'border-red-300 bg-red-50/40' : c.needs1099 ? 'border-accent/50' : 'border-black/10'}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-sm font-bold">{c.displayName}</span>
                {c.businessName && <span className="font-mono text-[10px] text-black/40">{c.businessName}</span>}
                <span className="font-mono text-sm ml-auto">{formatCents(c.ytdPaidCents)} <span className="text-black/40 text-[10px]">YTD</span></span>
                {c.cashCents > 0 && <span className="font-mono text-[10px] text-black/40">({formatCents(c.cashCents)} cash)</span>}
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {c.needs1099
                  ? <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 bg-accent text-black">1099-NEC required</span>
                  : <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-black/5 text-black/40">under $600</span>}
                {c.hasW9
                  ? <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-green-100 text-green-700 inline-flex items-center gap-1"><Check className="w-3 h-3" /> W-9 on file</span>
                  : <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-red-100 text-red-700">No W-9</span>}
                {c.tinLast4 && <span className="font-mono text-[10px] text-black/40">TIN …{c.tinLast4}</span>}
                <button onClick={() => markW9(c.id, !c.hasW9)} className="ml-auto font-mono text-[10px] underline text-black/50 hover:text-black">
                  {c.hasW9 ? 'Clear W-9' : 'Mark W-9 received'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lessons ──────────────────────────────────────────────────────────────────

function LessonsTab() {
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
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
