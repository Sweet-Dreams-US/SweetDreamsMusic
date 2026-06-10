'use client';

// components/admin/TaxExpenses.tsx — the ONE expense-management surface, shared
// by the Tax Center (whole-year) and the Accounting Profit view (any period).
// Entry + edit + receipt upload/view + recurring templates. One system, two
// doors — the numbers can't diverge because both read the same rows.

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, ChevronDown, Receipt, Pencil, Repeat, X } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { EXPENSE_CATEGORIES, EQUIPMENT_SUGGEST_CENTS } from '@/lib/tax';

interface Expense { id: string; incurredOn: string; amountCents: number; vendor: string | null; category: string; description: string; isEquipment: boolean; receiptStoragePath: string | null }
interface Template { id: string; label: string; category: string; amount_cents: number; vendor: string | null; day_of_month: number; active: boolean }

async function openSignedFile(query: string) {
  try {
    const res = await fetch(`/api/admin/tax/file?${query}`);
    const j = await res.json();
    if (res.ok && j.url) window.open(j.url, '_blank', 'noopener');
    else alert(j.error || 'No file on record');
  } catch { alert('Could not open the file'); }
}

export default function TaxExpenses({ from, to, showRecurring = true, onChanged }: {
  from: string; to: string; showRecurring?: boolean; onChanged?: () => void;
}) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState({ incurred_on: new Date().toISOString().slice(0, 10), amount: '', vendor: '', category: 'supplies', description: '' });
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [tplForm, setTplForm] = useState({ label: '', amount: '', category: 'rent', vendor: '', day_of_month: '1' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetches: Promise<Response>[] = [fetch(`/api/admin/tax/expenses?from=${from}&to=${to}`)];
      if (showRecurring) fetches.push(fetch('/api/admin/tax/recurring'));
      const [er, tr] = await Promise.all(fetches.map((p) => p.then((r) => r.json())));
      if (er?.expenses) setExpenses(er.expenses);
      if (tr?.templates) setTemplates(tr.templates);
    } catch { /* ignore */ }
    setLoading(false);
  }, [from, to, showRecurring]);
  useEffect(() => { load(); }, [load]);

  const changed = async () => { await load(); onChanged?.(); };

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
      if (editing) {
        await fetch('/api/admin/tax/expenses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, receipt_storage_path: data.filePath }) });
        await changed();
      }
    } catch { setErr('Upload error'); }
  }

  async function save() {
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setErr('Enter a valid amount'); return; }
    if (!form.description.trim()) { setErr('Description required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = editing
        ? await fetch('/api/admin/tax/expenses', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editing.id, ...form, amount_cents: cents }),
          })
        : await fetch('/api/admin/tax/expenses', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...form, amount_cents: cents, receipt_storage_path: receiptPath }),
          });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'Save failed'); setBusy(false); return; }
      setForm({ ...form, amount: '', vendor: '', description: '' }); setReceiptPath(null); setEditing(null);
      await changed();
    } catch { setErr('Network error'); }
    setBusy(false);
  }

  function startEdit(e: Expense) {
    setEditing(e);
    setForm({ incurred_on: e.incurredOn, amount: (e.amountCents / 100).toFixed(2), vendor: e.vendor ?? '', category: e.category, description: e.description });
  }

  async function remove(id: string) {
    if (!confirm('Delete this expense?')) return;
    await fetch(`/api/admin/tax/expenses?id=${id}`, { method: 'DELETE' });
    await changed();
  }

  async function addTemplate() {
    const cents = Math.round(parseFloat(tplForm.amount) * 100);
    if (!tplForm.label.trim() || !Number.isFinite(cents) || cents <= 0) { setErr('Template needs a label + amount'); return; }
    const res = await fetch('/api/admin/tax/recurring', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: tplForm.label, amount_cents: cents, category: tplForm.category, vendor: tplForm.vendor, day_of_month: Number(tplForm.day_of_month) }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error || 'Save failed'); return; }
    setTplForm({ label: '', amount: '', category: 'rent', vendor: '', day_of_month: '1' });
    await changed();
  }

  async function toggleTemplate(t: Template) {
    await fetch('/api/admin/tax/recurring', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, active: !t.active }) });
    await changed();
  }
  async function removeTemplate(id: string) {
    if (!confirm('Delete this recurring template? Already-created expenses stay.')) return;
    await fetch(`/api/admin/tax/recurring?id=${id}`, { method: 'DELETE' });
    await changed();
  }

  const total = expenses.reduce((s, e) => s + e.amountCents, 0);
  return (
    <div className="space-y-5">
      <div className="border-2 border-accent/50 bg-accent/5 p-4">
        <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3">
          {editing ? `Edit expense — ${editing.description.slice(0, 40)}` : 'Add expense'}
          {editing && <button onClick={() => { setEditing(null); setForm({ incurred_on: new Date().toISOString().slice(0, 10), amount: '', vendor: '', category: 'supplies', description: '' }); }} className="ml-2 text-black/40 hover:text-black"><X className="w-3 h-3 inline" /></button>}
        </p>
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
            <Receipt className="w-3 h-3" /> {receiptPath ? 'Receipt attached ✓' : editing?.receiptStoragePath ? 'Replace receipt' : 'Attach receipt'}
          </label>
          {parseFloat(form.amount) * 100 >= EQUIPMENT_SUGGEST_CENTS && form.category !== 'equipment' && (
            <span className="font-mono text-[10px] text-amber-700">Over $2,500 — consider the Equipment category (Section 179).</span>
          )}
          <button onClick={save} disabled={busy} className="ml-auto bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-1.5 hover:bg-black/80 disabled:opacity-50 inline-flex items-center gap-1">
            {editing ? <Pencil className="w-3 h-3" /> : <Plus className="w-3 h-3" />} {busy ? 'Saving…' : editing ? 'Save changes' : 'Add'}
          </button>
        </div>
        {err && <p className="font-mono text-xs text-red-600 mt-2">{err}</p>}
        <p className="font-mono text-[10px] text-black/40 mt-2">Contractor payouts are entered in Accounting → Payroll — they flow into your P&amp;L automatically. Don&apos;t add them here.</p>
      </div>

      {showRecurring && (
        <div className="border-2 border-black/10 p-4">
          <button onClick={() => setRecurringOpen(!recurringOpen)} className="w-full flex items-center justify-between">
            <span className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
              <Repeat className="w-3.5 h-3.5 text-accent" /> Recurring expenses
              <span className="text-black/40 normal-case font-normal">— rent, subscriptions; auto-logged monthly ({templates.filter((t) => t.active).length} active)</span>
            </span>
            <ChevronDown className={`w-4 h-4 text-black/40 transition-transform ${recurringOpen ? 'rotate-180' : ''}`} />
          </button>
          {recurringOpen && (
            <div className="mt-3 space-y-2">
              {templates.map((t) => (
                <div key={t.id} className={`flex items-center gap-3 border border-black/10 px-3 py-2 font-mono text-sm ${!t.active ? 'opacity-50' : ''}`}>
                  <span className="flex-1 truncate">{t.label}{t.vendor ? <span className="text-black/40"> · {t.vendor}</span> : ''}</span>
                  <span className="text-[10px] text-black/40 uppercase">day {t.day_of_month}</span>
                  <span className="font-bold">{formatCents(t.amount_cents)}/mo</span>
                  <button onClick={() => toggleTemplate(t)} className="font-mono text-[10px] underline text-black/50 hover:text-black">{t.active ? 'pause' : 'resume'}</button>
                  <button onClick={() => removeTemplate(t.id)} className="text-black/20 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-1">
                <input placeholder="Label (e.g. Studio rent)" value={tplForm.label} onChange={(e) => setTplForm({ ...tplForm, label: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none md:col-span-2" />
                <input inputMode="decimal" placeholder="$/month" value={tplForm.amount} onChange={(e) => setTplForm({ ...tplForm, amount: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
                <select value={tplForm.category} onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none">
                  {EXPENSE_CATEGORIES.filter((c) => c.key !== 'contract_labor').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <input placeholder="Day (1–28)" inputMode="numeric" value={tplForm.day_of_month} onChange={(e) => setTplForm({ ...tplForm, day_of_month: e.target.value })} className="border-2 border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
                <button onClick={addTemplate} className="bg-black text-white font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-black/80">Add monthly</button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? <p className="font-mono text-sm text-black/40">Loading…</p> : (
        <div>
          <div className="flex justify-between font-mono text-xs text-black/50 uppercase tracking-wider mb-2">
            <span>{expenses.length} expense{expenses.length === 1 ? '' : 's'} · {from} → {to}</span>
            <span>Total {formatCents(total)}</span>
          </div>
          {expenses.length === 0 ? (
            <p className="font-mono text-xs text-black/40 border-2 border-dashed border-black/10 p-6 text-center">No expenses logged in this period.</p>
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
                    {e.receiptStoragePath && (
                      <button onClick={() => openSignedFile(`expense=${e.id}`)} title="View receipt" className="text-green-600 hover:text-green-800">
                        <Receipt className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => startEdit(e)} className="text-black/20 hover:text-black" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(e.id)} className="text-black/20 hover:text-red-500" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
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
