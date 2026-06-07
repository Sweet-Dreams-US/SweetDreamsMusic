'use client';

// EngineersManager — the "Team" section of the Studio Control Panel. Add/edit the
// engineer roster shown on /engineers + in the booking pickers. The canonical
// email/name (payroll identity) is set once at create and not edited here. Room
// assignment lives in the Studios & Pricing section.

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Eng { id: string; name: string; displayName: string; email: string; specialties: string[]; photoUrl: string | null; bio: string | null; active: boolean; sortOrder: number; studios: string[] }

export default function EngineersManager() {
  const [list, setList] = useState<Eng[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState('');
  const [adding, setAdding] = useState(false);
  const [neu, setNeu] = useState({ name: '', email: '', display_name: '' });
  const [msg, setMsg] = useState('');

  function load() {
    setLoading(true);
    fetch('/api/admin/engineers').then((r) => r.json()).then((d) => setList(d.engineers || [])).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function field(e: Eng, k: string): any {
    const buf = edits[e.id] || {};
    if (k in buf) return buf[k];
    if (k === 'specialties') return e.specialties.join(', ');
    return (e as any)[k === 'display_name' ? 'displayName' : k === 'photo_url' ? 'photoUrl' : k];
  }
  function set(id: string, k: string, v: any) { setEdits((x) => ({ ...x, [id]: { ...(x[id] || {}), [k]: v } })); }

  async function save(e: Eng) {
    setSaving(e.id); setMsg('');
    const buf = edits[e.id] || {};
    const updates: any = {};
    for (const k of Object.keys(buf)) {
      updates[k] = k === 'specialties' ? String(buf[k]).split(',').map((s) => s.trim()).filter(Boolean) : buf[k];
    }
    try {
      const res = await fetch('/api/admin/engineers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, updates }) });
      if (res.ok) { setEdits((x) => { const n = { ...x }; delete n[e.id]; return n; }); load(); } else setMsg((await res.json()).error || 'Save failed');
    } catch { setMsg('Save failed'); } finally { setSaving(''); }
  }

  async function add() {
    if (!neu.name.trim() || !neu.email.trim()) { setMsg('Name and email required.'); return; }
    setSaving('new'); setMsg('');
    try {
      const res = await fetch('/api/admin/engineers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...neu, display_name: neu.display_name || neu.name }) });
      if (res.ok) { setNeu({ name: '', email: '', display_name: '' }); setAdding(false); load(); } else setMsg((await res.json()).error || 'Add failed');
    } catch { setMsg('Add failed'); } finally { setSaving(''); }
  }

  if (loading) return <div className="flex items-center gap-2 text-black/40 font-mono text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-2xl space-y-3">
      {msg && <p className="font-mono text-xs text-black/60">{msg}</p>}
      {list.map((e) => {
        const dirty = !!edits[e.id];
        return (
          <div key={e.id} className="border-2 border-black/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-sm font-bold">{e.name} <span className="font-normal text-black/40">{e.email}</span></p>
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-black/50">
                <input type="checkbox" checked={field(e, 'active')} onChange={(ev) => set(e.id, 'active', ev.target.checked)} /> active
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LabeledMini label="Display name"><input value={field(e, 'display_name') ?? ''} onChange={(ev) => set(e.id, 'display_name', ev.target.value)} className={inp} /></LabeledMini>
              <LabeledMini label="Photo URL"><input value={field(e, 'photo_url') ?? ''} onChange={(ev) => set(e.id, 'photo_url', ev.target.value)} className={inp} /></LabeledMini>
              <LabeledMini label="Specialties (comma-separated)" wide><input value={field(e, 'specialties') ?? ''} onChange={(ev) => set(e.id, 'specialties', ev.target.value)} className={inp} /></LabeledMini>
              <LabeledMini label="Bio" wide><input value={field(e, 'bio') ?? ''} onChange={(ev) => set(e.id, 'bio', ev.target.value)} className={inp} /></LabeledMini>
            </div>
            <div className="flex items-center gap-3">
              <button disabled={!dirty || saving === e.id} onClick={() => save(e)} className="font-mono text-[11px] font-bold uppercase px-3 py-1.5 bg-accent text-black hover:bg-accent/90 disabled:opacity-30">Save</button>
              <span className="font-mono text-[10px] text-black/30">rooms: {e.studios.join(', ') || 'none (assign in Studios & Pricing)'}</span>
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="border-2 border-accent p-3 space-y-2">
          <p className="font-mono text-xs font-bold uppercase tracking-wider">New engineer</p>
          <p className="font-mono text-[10px] text-black/40">Email is the permanent payroll identity — choose carefully (it can&apos;t be changed here).</p>
          <div className="grid grid-cols-3 gap-2">
            <LabeledMini label="Name *"><input value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} className={inp} /></LabeledMini>
            <LabeledMini label="Display"><input value={neu.display_name} onChange={(e) => setNeu({ ...neu, display_name: e.target.value })} className={inp} /></LabeledMini>
            <LabeledMini label="Email *"><input value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} className={inp} /></LabeledMini>
          </div>
          <div className="flex gap-2">
            <button disabled={saving === 'new'} onClick={add} className="font-mono text-[11px] font-bold uppercase px-3 py-1.5 bg-accent text-black hover:bg-accent/90 disabled:opacity-40">{saving === 'new' ? 'Adding…' : 'Add engineer'}</button>
            <button onClick={() => setAdding(false)} className="font-mono text-[11px] font-bold uppercase px-3 py-1.5 border-2 border-black hover:bg-black/5">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border-2 border-dashed border-black/20 hover:border-accent transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add engineer
        </button>
      )}
    </div>
  );
}

const inp = 'w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none';
function LabeledMini({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? 'col-span-2' : ''}><label className="block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">{label}</label>{children}</div>;
}
