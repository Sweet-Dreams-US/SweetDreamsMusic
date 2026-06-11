'use client';

// components/admin/TaxProfileManager.tsx — the "Tax Profile" section of the
// Studio Control Panel (Plan 5 Phase 1). Entity type + state + estimated rate;
// drives the Tax Center's estimate math + copy. Admin only.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ENTITY_TYPES, TAX_DISCLAIMER } from '@/lib/tax';

interface Profile {
  entityType: string; einLast4: string | null; state: string | null;
  fiscalYearStartMonth: number; estimatedIncomeTaxRatePct: number; applyQbi: boolean; notes: string | null;
}

export default function TaxProfileManager() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [edit, setEdit] = useState<Partial<Profile> & { ein_last4?: string }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/tax/profile').then((r) => r.json()).then((j) => {
      if (j.profile) { setProfile(j.profile); }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    const body: Record<string, unknown> = {
      entity_type: edit.entityType ?? profile?.entityType,
      state: edit.state ?? profile?.state ?? '',
      estimated_income_tax_rate: edit.estimatedIncomeTaxRatePct ?? profile?.estimatedIncomeTaxRatePct,
      apply_qbi: edit.applyQbi ?? profile?.applyQbi ?? true,
      notes: edit.notes ?? profile?.notes ?? '',
    };
    if (edit.ein_last4 != null) body.ein_last4 = edit.ein_last4;
    try {
      const res = await fetch('/api/admin/tax/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Save failed'); } else { setProfile(j.profile); setEdit({}); setMsg('Saved.'); }
    } catch { setMsg('Network error'); }
    setSaving(false);
  }

  if (loading) return <p className="font-mono text-sm text-black/40 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>;

  const v = { ...profile, ...edit } as Profile & { ein_last4?: string };
  const labelCls = 'block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1';
  const inputCls = 'w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none';

  return (
    <div className="max-w-xl space-y-4">
      <p className="font-mono text-[10px] text-black/40 italic border-l-2 border-accent/40 pl-2">{TAX_DISCLAIMER}</p>
      <div>
        <label className={labelCls}>Business entity type</label>
        <select className={inputCls} value={v.entityType} onChange={(e) => setEdit({ ...edit, entityType: e.target.value })}>
          {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <p className="font-mono text-[11px] text-black/40 mt-1">{ENTITY_TYPES.find((t) => t.value === v.entityType)?.note}</p>
        {v.entityType === 'partnership' && (
          <p className="font-mono text-[11px] text-amber-700 mt-1">
            Guaranteed payments are NOT QBI — if most profit flows out as guaranteed payments, the 20% deduction is being left on the table. Flag for your CPA conversation.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>State</label>
          <input className={inputCls} maxLength={2} placeholder="IN" value={v.state ?? ''} onChange={(e) => setEdit({ ...edit, state: e.target.value.toUpperCase() })} />
        </div>
        <div>
          <label className={labelCls}>EIN (last 4)</label>
          <input className={inputCls} maxLength={4} placeholder="••••" value={edit.ein_last4 ?? v.einLast4 ?? ''} onChange={(e) => setEdit({ ...edit, ein_last4: e.target.value })} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Estimated income tax rate (%)</label>
        <input className={inputCls} inputMode="decimal" value={v.estimatedIncomeTaxRatePct ?? 22} onChange={(e) => setEdit({ ...edit, estimatedIncomeTaxRatePct: Number(e.target.value) })} />
        <p className="font-mono text-[11px] text-black/40 mt-1">Your blended federal + state income rate, set with your accountant. Drives the quarterly set-aside estimate (separate from self-employment tax).</p>
      </div>
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wider text-black/70 font-bold inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={v.applyQbi ?? true} onChange={(e) => setEdit({ ...edit, applyQbi: e.target.checked })} />
          Apply QBI deduction (20%)
        </label>
        <p className="font-mono text-[11px] text-black/40 mt-1">The permanent 20% qualified business income deduction. Phase-outs start around $400K joint — far above typical studio income. Ask your accountant if unsure.</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save tax profile'}
        </button>
        {msg && <span className="font-mono text-xs text-black/50">{msg}</span>}
      </div>
    </div>
  );
}
