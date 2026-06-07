'use client';

// BrandManager — the "Brand" section of the Studio Control Panel. Edits the
// studio's identity (name, contact, address) used across the public site + SEO.
// White-label studios set their own here.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const FIELDS: { col: string; label: string; type?: string; help?: string }[] = [
  { col: 'name', label: 'Studio name', help: 'Shown in the header, footer, page titles, and SEO.' },
  { col: 'legal_name', label: 'Legal name', help: 'For SEO/structured data (e.g. "… LLC").' },
  { col: 'tagline', label: 'Tagline' },
  { col: 'email', label: 'Contact email', type: 'email' },
  { col: 'phone', label: 'Phone' },
  { col: 'addr_street', label: 'Street' },
  { col: 'addr_city', label: 'City' },
  { col: 'addr_state', label: 'State' },
  { col: 'addr_zip', label: 'ZIP' },
  { col: 'addr_country', label: 'Country' },
];

export default function BrandManager() {
  const [brand, setBrand] = useState<Record<string, string> | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  function load() {
    setLoading(true);
    fetch('/api/admin/brand').then((r) => r.json()).then((d) => { setBrand(d.brand); setEdit(d.brand || {}); }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const dirty = brand && FIELDS.some((f) => (edit[f.col] ?? '') !== (brand[f.col] ?? ''));

  async function save() {
    setSaving(true); setMsg('');
    try {
      const res = await fetch('/api/admin/brand', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Save failed'); return; }
      setMsg('Saved. Public site + SEO updated.'); load();
    } catch { setMsg('Save failed'); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center gap-2 text-black/40 font-mono text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  if (!brand) return <div className="font-mono text-sm text-red-600 py-8">Couldn&apos;t load brand settings.</div>;

  return (
    <div className="max-w-xl space-y-4">
      <p className="font-mono text-xs text-black/50">Your studio&apos;s identity — appears in the header, footer, page titles, and search-engine data.</p>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.col} className={f.col === 'name' || f.col === 'legal_name' || f.col === 'tagline' || f.col === 'email' ? 'col-span-2' : ''}>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">{f.label}</label>
            <input
              type={f.type || 'text'}
              value={edit[f.col] ?? ''}
              onChange={(e) => setEdit((x) => ({ ...x, [f.col]: e.target.value }))}
              className="w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none"
            />
            {f.help && <p className="font-mono text-[10px] text-black/35 mt-0.5">{f.help}</p>}
          </div>
        ))}
      </div>
      {msg && <p className="font-mono text-xs text-black/60">{msg}</p>}
      <button disabled={!dirty || saving} onClick={save}
        className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 transition-colors disabled:opacity-40">
        {saving ? 'Saving…' : 'Save brand'}
      </button>
    </div>
  );
}
