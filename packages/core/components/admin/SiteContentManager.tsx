'use client';

// SiteContentManager — the "Content" section of the Studio Control Panel. Edits
// public-page copy + images (site_content), grouped by page. Each field falls back
// to the in-code default, so editing is always safe. Image fields upload directly
// to Supabase Storage (signed URL) and store the public URL.

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Upload } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Field { key: string; group: string; label: string; kind: string; value: any; isDefault: boolean }

export default function SiteContentManager() {
  const [fields, setFields] = useState<Field[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState('');
  const [seeding, setSeeding] = useState(false);

  function load() {
    setLoading(true);
    fetch('/api/admin/content').then((r) => r.json()).then((d) => {
      setFields(d.fields || []); setGroups(d.groups || []);
      if (d.groups?.length && !tab) setTab(d.groups[0]);
    }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(f: Field, value: any) {
    setSaving(f.key);
    try {
      const res = await fetch('/api/admin/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.key, value }) });
      if (res.ok) { setEdits((e) => { const n = { ...e }; delete n[f.key]; return n; }); load(); }
    } catch { /* ignore */ } finally { setSaving(''); }
  }
  async function reset(f: Field) {
    setSaving(f.key);
    try {
      const res = await fetch(`/api/admin/content?key=${encodeURIComponent(f.key)}`, { method: 'DELETE' });
      if (res.ok) { setEdits((e) => { const n = { ...e }; delete n[f.key]; return n; }); load(); }
    } catch { /* ignore */ } finally { setSaving(''); }
  }

  async function uploadImage(f: Field, file: File) {
    setSaving(f.key);
    try {
      const signRes = await fetch('/api/admin/content/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name }) });
      const sign = await signRes.json();
      if (!sign.signedUrl) throw new Error(sign.error || 'no url');
      const put = await fetch(sign.signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('upload failed');
      await save(f, sign.publicUrl);
    } catch { setSaving(''); }
  }

  if (loading) return <div className="flex items-center gap-2 text-black/40 font-mono text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  const shown = fields.filter((f) => f.group === tab);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-0 border-b border-black/10 flex-1 overflow-x-auto">
          {groups.map((g) => (
            <button key={g} onClick={() => setTab(g)}
              className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 border-b-2 transition-colors ${tab === g ? 'border-accent text-black' : 'border-transparent text-black/40 hover:text-black/70'}`}>
              {g}
            </button>
          ))}
        </div>
        <button onClick={async () => { setSeeding(true); try { await fetch('/api/admin/content/seed', { method: 'POST' }); load(); } catch { /* */ } finally { setSeeding(false); } }}
          className="ml-3 font-mono text-[10px] font-bold uppercase tracking-wider text-black/40 hover:text-black whitespace-nowrap">
          {seeding ? 'Seeding…' : 'Seed defaults'}
        </button>
      </div>

      <div className="space-y-4">
        {shown.map((f) => {
          const cur = edits[f.key] !== undefined ? edits[f.key] : f.value;
          const dirty = edits[f.key] !== undefined && edits[f.key] !== f.value;
          return (
            <div key={f.key} className="border-2 border-black/10 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-mono text-xs font-bold">{f.label}
                  {f.isDefault && <span className="ml-2 text-[9px] font-normal uppercase tracking-wider text-black/30 border border-black/15 rounded px-1.5 py-0.5">default</span>}
                </label>
                <span className="font-mono text-[9px] text-black/25">{f.key}</span>
              </div>

              {f.kind === 'image' ? (
                <div className="flex items-center gap-3">
                  {cur && <img src={cur} alt="" className="w-24 h-16 object-cover border border-black/15" />}
                  <div className="flex-1 space-y-1.5">
                    <input value={cur ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [f.key]: e.target.value }))} placeholder="Image URL"
                      className="w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
                    <label className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-black/50 hover:text-black cursor-pointer">
                      <Upload className="w-3 h-3" /> Upload
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(f, file); }} />
                    </label>
                  </div>
                </div>
              ) : f.kind === 'richtext' ? (
                <textarea value={cur ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [f.key]: e.target.value }))} rows={3}
                  className="w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none resize-y" />
              ) : (
                <input value={cur ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [f.key]: e.target.value }))} type={f.kind === 'number' ? 'number' : 'text'}
                  className="w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
              )}

              <div className="flex items-center gap-3 mt-2">
                <button disabled={!dirty || saving === f.key} onClick={() => save(f, cur)}
                  className="font-mono text-[11px] font-bold uppercase px-3 py-1.5 bg-accent text-black hover:bg-accent/90 transition-colors disabled:opacity-30">
                  {saving === f.key ? 'Saving…' : 'Save'}
                </button>
                {!f.isDefault && (
                  <button disabled={saving === f.key} onClick={() => reset(f)}
                    className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-black/40 hover:text-red-600">
                    <RotateCcw className="w-3 h-3" /> Reset to default
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
