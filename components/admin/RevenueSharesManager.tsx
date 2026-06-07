'use client';

// RevenueSharesManager — the "Revenue Shares" section of the Studio Control Panel.
// Edit per-studio default splits + per-person overrides. Saving a default opens a
// what-if preview (the persuasion) + a type-to-confirm. Historical payroll is
// frozen by per-transaction snapshots, so edits only move future work.

import { useEffect, useState } from 'react';
import { Loader2, Percent, TrendingUp } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fmt = (cents: number) => `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Tab = 'defaults' | 'engineers' | 'producers';
const SETTINGS: { col: string; label: string; help?: string }[] = [
  { col: 'engineer_session_pct', label: 'Engineer solo session split', help: 'Engineer cut of a SOLO session; business keeps the rest.' },
  { col: 'engineer_band_session_pct', label: 'Engineer band session split', help: 'Engineer cut of a BAND session (higher — harder, multi-person work). Inherits the solo split when blank.' },
  { col: 'producer_commission_pct', label: 'Producer beat commission', help: 'Producer cut of a beat sale; platform keeps the rest.' },
  { col: 'media_seller_pct', label: 'Media seller commission' },
  { col: 'media_worker_pct', label: 'Media worker (film + edit)' },
  { col: 'media_business_pct', label: 'Media business cut' },
  { col: 'renewal_discount_pct', label: 'Lease renewal price', help: '% of original price charged on a lease renewal.' },
];

export default function RevenueSharesManager() {
  const [tab, setTab] = useState<Tab>('defaults');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch('/api/admin/revenue').then((r) => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);

  if (loading) return <div className="flex items-center gap-2 text-black/40 font-mono text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  if (!data) return <div className="font-mono text-sm text-red-600 py-8">Couldn&apos;t load revenue settings.</div>;

  return (
    <div>
      <div className="flex gap-0 border-b border-black/10 mb-6">
        {(['defaults', 'engineers', 'producers'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 border-b-2 transition-colors ${tab === t ? 'border-accent text-black' : 'border-transparent text-black/40 hover:text-black/70'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'defaults' && <DefaultsTab settings={data.settings} onSaved={load} />}
      {tab === 'engineers' && <PeopleTab kind="engineer" rows={data.engineers} defaultPct={data.settings.engineer_session_pct} bandDefaultPct={data.settings.engineer_band_session_pct} onSaved={load} />}
      {tab === 'producers' && <PeopleTab kind="producer" rows={data.producers} defaultPct={data.settings.producer_commission_pct} onSaved={load} />}
    </div>
  );
}

function DefaultsTab({ settings, onSaved }: { settings: Record<string, number>; onSaved: () => void }) {
  const [edit, setEdit] = useState<Record<string, string>>(() => Object.fromEntries(SETTINGS.map((s) => [s.col, String(settings[s.col] ?? 0)])));
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [whatif, setWhatif] = useState<any | null>(null);
  const [loadingWhatif, setLoadingWhatif] = useState(false);
  const [err, setErr] = useState('');

  const mediaSum = Number(edit.media_seller_pct || 0) + Number(edit.media_worker_pct || 0) + Number(edit.media_business_pct || 0);
  const mediaOk = Math.round(mediaSum) === 100;
  const dirty = SETTINGS.some((s) => String(settings[s.col] ?? 0) !== edit[s.col]);

  async function preview() {
    setLoadingWhatif(true); setWhatif(null);
    try {
      const res = await fetch('/api/admin/revenue/whatif', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hypothetical: Object.fromEntries(SETTINGS.map((s) => [s.col, Number(edit[s.col])])) }),
      });
      setWhatif(await res.json());
    } catch { /* ignore */ } finally { setLoadingWhatif(false); }
  }

  async function save() {
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/admin/revenue', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'settings', updates: Object.fromEntries(SETTINGS.map((s) => [s.col, Number(edit[s.col])])) }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'Save failed'); return; }
      onSaved();
    } catch { setErr('Save failed'); } finally { setSaving(false); setConfirm(false); }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {SETTINGS.map((s) => (
          <div key={s.col}>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">{s.label}</label>
            <div className="flex items-center gap-1">
              <input value={edit[s.col]} onChange={(e) => setEdit((x) => ({ ...x, [s.col]: e.target.value }))} inputMode="decimal"
                className="w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
              <Percent className="w-3.5 h-3.5 text-black/30" />
            </div>
            {s.help && <p className="font-mono text-[10px] text-black/35 mt-0.5">{s.help}</p>}
          </div>
        ))}
      </div>

      <div className={`font-mono text-xs ${mediaOk ? 'text-black/50' : 'text-red-600 font-bold'}`}>
        Media split total: {mediaSum}% {mediaOk ? '✓' : '— must equal 100% (seller + worker + business)'}
      </div>

      {/* What-if preview (the persuasion). */}
      <div className="border-2 border-black/10 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Impact preview</span>
          <button onClick={preview} disabled={loadingWhatif} className="font-mono text-[11px] font-bold uppercase px-3 py-1.5 border-2 border-black hover:bg-black hover:text-white transition-colors disabled:opacity-40">
            {loadingWhatif ? 'Calculating…' : 'Preview impact'}
          </button>
        </div>
        {whatif ? (
          <div className="space-y-1.5">
            <p className="font-mono text-xs">
              Total staff payroll (all-time work): <strong>{fmt(whatif.totalBaseline)}</strong> → <strong>{fmt(whatif.totalSim)}</strong>{' '}
              <span className={whatif.payrollDelta === 0 ? 'text-black/40' : whatif.payrollDelta > 0 ? 'text-amber-600' : 'text-green-700'}>
                ({whatif.payrollDelta >= 0 ? '+' : ''}{fmt(whatif.payrollDelta)})
              </span>
            </p>
            <p className="font-mono text-xs text-black/60">Business net moves {whatif.businessNetDelta >= 0 ? '+' : ''}{fmt(whatif.businessNetDelta)} (gross fixed).</p>
            {whatif.perPerson?.filter((p: any) => p.delta !== 0).length > 0 && (
              <div className="mt-2 pt-2 border-t border-black/10 space-y-1">
                {whatif.perPerson.filter((p: any) => p.delta !== 0).map((p: any) => (
                  <div key={p.name} className="flex justify-between font-mono text-[11px]">
                    <span className="text-black/60">{p.name}</span>
                    <span>{fmt(p.baseline)} → {fmt(p.sim)} <span className={p.delta > 0 ? 'text-amber-600' : 'text-green-700'}>({p.delta >= 0 ? '+' : ''}{fmt(p.delta)})</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="font-mono text-[11px] text-black/40">Preview how these shares would have changed total payroll across all recorded work.</p>
        )}
      </div>

      {err && <p className="font-mono text-xs text-red-600">{err}</p>}
      <button disabled={!dirty || !mediaOk || saving} onClick={() => setConfirm(true)}
        className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 transition-colors disabled:opacity-40">
        Save defaults
      </button>

      <ConfirmDialog
        open={confirm}
        tier="type-to-confirm"
        tone="warning"
        title="Change revenue shares?"
        confirmWord="CONFIRM"
        confirmLabel="Save new shares"
        busy={saving}
        impact="This changes how every FUTURE payout is calculated for everyone in these roles. Historical payroll is frozen (each past transaction keeps its recorded rate) and will not change."
        persuasion={whatif ? `Previewed impact on all recorded work: total payroll ${whatif.payrollDelta >= 0 ? '+' : ''}${fmt(whatif.payrollDelta)}.` : 'Tip: run the impact preview first to see how this affects payroll.'}
        onConfirm={save}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

function PeopleTab({ kind, rows, defaultPct, bandDefaultPct, onSaved }: { kind: 'engineer' | 'producer'; rows: any[]; defaultPct: number; bandDefaultPct?: number; onSaved: () => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [bandEdits, setBandEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');

  async function save(idVal: string, body: Record<string, unknown>) {
    setSaving(idVal);
    try {
      await fetch('/api/admin/revenue', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, [kind === 'engineer' ? 'id' : 'userId']: idVal, ...body }),
      });
      onSaved();
    } catch { /* ignore */ } finally { setSaving(''); }
  }
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

  if (!rows.length) return <p className="font-mono text-sm text-black/40 py-4">No {kind}s found.</p>;

  return (
    <div className="max-w-2xl space-y-2">
      <p className="font-mono text-xs text-black/50 mb-3">
        Leave a split blank to inherit the studio default ({defaultPct}%{kind === 'engineer' && bandDefaultPct != null ? `; band ${bandDefaultPct}%` : ''}).
        {kind === 'engineer' && ' Toggle “Bands” to allow an engineer to be booked for band sessions.'}
      </p>
      {rows.map((r) => {
        const idVal = kind === 'engineer' ? r.id : r.user_id;
        const name = kind === 'engineer' ? (r.display_name || r.name) : (r.producer_name || r.display_name || '(unnamed producer)');
        const current = kind === 'engineer' ? r.session_split_pct : r.producer_commission_pct;
        const buf = edits[idVal] ?? (current == null ? '' : String(current));
        const dirty = buf !== (current == null ? '' : String(current));
        const bandCur = r.band_session_split_pct;
        const bandBuf = bandEdits[idVal] ?? (bandCur == null ? '' : String(bandCur));
        const bandDirty = bandBuf !== (bandCur == null ? '' : String(bandCur));
        return (
          <div key={idVal} className="flex items-center gap-2 border-2 border-black/10 p-3 flex-wrap">
            <span className="flex-1 min-w-[110px] font-mono text-sm font-bold">{name}</span>
            <label className="font-mono text-[10px] uppercase tracking-wider text-black/40">{kind === 'engineer' ? 'Solo' : '%'}</label>
            <input value={buf} onChange={(e) => setEdits((x) => ({ ...x, [idVal]: e.target.value }))} inputMode="decimal"
              placeholder={`${defaultPct}`}
              className="w-16 border-2 border-black/15 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
            {kind === 'engineer' && (
              <>
                <label className="font-mono text-[10px] uppercase tracking-wider text-black/40">Band</label>
                <input value={bandBuf} onChange={(e) => setBandEdits((x) => ({ ...x, [idVal]: e.target.value }))} inputMode="decimal"
                  placeholder={`${bandDefaultPct ?? defaultPct}`}
                  className="w-16 border-2 border-black/15 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
                <label className="flex items-center gap-1.5 font-mono text-[11px] cursor-pointer select-none">
                  <input type="checkbox" checked={!!r.can_book_bands} disabled={saving === idVal}
                    onChange={(e) => save(idVal, { canBookBands: e.target.checked })} />
                  Bands
                </label>
              </>
            )}
            <button disabled={(!dirty && !bandDirty) || saving === idVal}
              onClick={() => save(idVal, { ...(dirty ? { pct: numOrNull(buf) } : {}), ...(kind === 'engineer' && bandDirty ? { bandPct: numOrNull(bandBuf) } : {}) })}
              className="font-mono text-[11px] font-bold uppercase px-3 py-2 border-2 border-black hover:bg-black hover:text-white transition-colors disabled:opacity-30">
              {saving === idVal ? '…' : 'Save'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
