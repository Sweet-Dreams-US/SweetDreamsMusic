'use client';

// Team-initiated media session (Phase 7) — the media analog of the engineer
// CreateInvite. A media manager picks an existing client, a date/time, kind,
// and the vision; POSTs to /api/media/team/create-session, which lands a
// confirmed manager-assigned session and emails the client. No 48h rule (the
// team is initiating), no credit consumed.

import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Check, Film } from 'lucide-react';
import { SESSION_KIND_LABELS, type MediaSessionKind } from '@/lib/media-scheduling';

interface Client {
  id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  profile_picture_url: string | null;
}

const KIND_OPTIONS: MediaSessionKind[] = ['video', 'photo', 'storyboard', 'marketing-meeting', 'planning_call', 'other'];

export default function CreateMediaInvite({ onCreated }: { onCreated?: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('11:00');
  const [duration, setDuration] = useState(2);
  const [kind, setKind] = useState<MediaSessionKind>('video');
  const [location, setLocation] = useState<'studio' | 'external'>('studio');
  const [externalText, setExternalText] = useState('');
  const [vision, setVision] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/library/clients').then((r) => r.json()).then((d) => setClients(d.clients || [])).catch(() => {});
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = q
      ? clients.filter((c) => c.display_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
      : clients;
    return list.slice(0, 10);
  }, [clients, search]);

  async function submit() {
    setError('');
    if (!selected) { setError('Pick a client.'); return; }
    if (!date || !time) { setError('Pick a date and time.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/media/team/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_user_id: selected.user_id,
          client_email: selected.email,
          date,
          start_time: time,
          duration_hours: duration,
          session_kind: kind,
          location,
          external_location_text: location === 'external' ? externalText.trim() : null,
          vision: vision.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not create session'); return; }
      setDone(true);
      onCreated?.();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-lg border-2 border-accent p-6">
        <div className="flex items-center gap-2 mb-2">
          <Check className="w-5 h-5 text-green-600" />
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider">Session booked</h3>
        </div>
        <p className="font-mono text-xs text-black/60 mb-4">
          {selected?.display_name} has been scheduled and emailed. It now shows in your jobs queue.
        </p>
        <button
          onClick={() => { setDone(false); setSelected(null); setSearch(''); setVision(''); setDate(''); }}
          className="font-mono text-xs font-bold uppercase tracking-wider bg-black text-white px-4 py-2 hover:bg-black/80"
        >
          Book another
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Film className="w-4 h-4 text-accent" /> New media session
        </h3>
        <p className="font-mono text-xs text-black/60 mt-1">
          Book a shoot for an existing client. They&apos;ll get an email and see it in their Artist Hub.
        </p>
      </div>

      {/* Client picker */}
      <div>
        <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Client</label>
        {selected ? (
          <div className="border-2 border-accent p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold truncate">{selected.display_name}</p>
              {selected.email && <p className="font-mono text-[10px] text-black/60 truncate">{selected.email}</p>}
            </div>
            <button onClick={() => setSelected(null)} className="text-black/30 hover:text-red-500 p-1"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="relative" ref={pickerRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowPicker(true); }}
              onFocus={() => setShowPicker(true)}
              placeholder="Search clients by name or email…"
              className="w-full border-2 border-black/20 pl-9 pr-4 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
            />
            {showPicker && filtered.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border-2 border-black/20 max-h-64 overflow-y-auto shadow-lg">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSelected(c); setShowPicker(false); setSearch(''); }}
                    className="w-full p-3 flex items-center gap-2 hover:bg-accent/10 text-left border-b border-black/5 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold truncate">{c.display_name}</p>
                      {c.email && <p className="font-mono text-[10px] text-black/60 truncate">{c.email}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Kind */}
      <div>
        <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Session type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as MediaSessionKind)} className="w-full border-2 border-black/20 px-3 py-2.5 font-mono text-sm focus:border-accent focus:outline-none">
          {KIND_OPTIONS.map((k) => <option key={k} value={k}>{SESSION_KIND_LABELS[k]}</option>)}
        </select>
      </div>

      {/* Date / time / duration */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border-2 border-black/20 px-2 py-2.5 font-mono text-xs focus:border-accent focus:outline-none" />
        </div>
        <div>
          <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full border-2 border-black/20 px-2 py-2.5 font-mono text-xs focus:border-accent focus:outline-none" />
        </div>
        <div>
          <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Hours</label>
          <input type="number" min={0.5} max={12} step={0.5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full border-2 border-black/20 px-2 py-2.5 font-mono text-xs focus:border-accent focus:outline-none" />
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Location</label>
        <div className="flex gap-2">
          {(['studio', 'external'] as const).map((loc) => (
            <button key={loc} type="button" onClick={() => setLocation(loc)} className={`flex-1 font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border-2 transition-colors ${location === loc ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'}`}>
              {loc === 'studio' ? 'Studio' : 'On Location'}
            </button>
          ))}
        </div>
        {location === 'external' && (
          <input type="text" value={externalText} onChange={(e) => setExternalText(e.target.value)} placeholder="Where?" className="w-full mt-2 border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
        )}
      </div>

      {/* Vision */}
      <div>
        <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Vision / notes</label>
        <textarea value={vision} onChange={(e) => setVision(e.target.value)} rows={3} placeholder="What's the shoot? References, looks, the plan…" className="w-full border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-vertical" />
      </div>

      {error && <p className="font-mono text-xs text-red-600">{error}</p>}

      <button onClick={submit} disabled={saving || !selected} className="w-full bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 disabled:opacity-50 transition-colors">
        {saving ? 'Booking…' : 'Book session'}
      </button>
    </div>
  );
}
