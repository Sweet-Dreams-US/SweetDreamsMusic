'use client';

// StudiosManager — the "Studios & Pricing" section of the Studio Control Panel.
// Live-edits studio_rooms (rates / hours / guest rules / deposit), pricing tiers
// (Sweet 4 + band), surcharges, and engineer assignments. The booking engine
// already reads these from the DB, so saves cascade to /pricing, /book, and the
// actual charge. Money fields are edited in dollars; stored as cents.

import { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronUp, Save } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const d = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));
const c = (dollars: string) => Math.round(parseFloat(dollars || '0') * 100);

const ROOM_FIELDS: { col: string; label: string; money?: boolean; nullable?: boolean }[] = [
  { col: 'hourly_rate_cents', label: 'Hourly rate', money: true },
  { col: 'single_hour_rate_cents', label: '1-hour rate', money: true },
  { col: 'deposit_percent', label: 'Deposit %' },
  { col: 'min_hours', label: 'Min hours' },
  { col: 'max_hours', label: 'Max hours' },
  { col: 'free_guests', label: 'Free guests (incl. artist)' },
  { col: 'guest_fee_cents', label: 'Extra guest fee / hr', money: true },
  { col: 'max_guests', label: 'Max guests' },
  { col: 'weekday_start_hour', label: 'Weekday start (24h decimal, blank = none)', nullable: true },
];

export default function StudiosManager() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, any>>({}); // roomId → field buffer
  const [confirm, setConfirm] = useState<null | { roomId: string; name: string }>(null);
  const [msg, setMsg] = useState('');

  function load() {
    setLoading(true);
    fetch('/api/admin/studios')
      .then((r) => r.json())
      .then((j) => { setData(j); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function roomBuf(room: any) {
    return edits[room.id] ?? room;
  }
  function setRoomField(roomId: string, col: string, value: any) {
    setEdits((e) => ({ ...e, [roomId]: { ...(e[roomId] ?? data.rooms.find((r: any) => r.id === roomId)), [col]: value } }));
  }

  async function patch(payload: any) {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/studios', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Save failed'); return false; }
      return true;
    } catch { setMsg('Save failed'); return false; }
    finally { setSaving(false); }
  }

  async function saveRoom(roomId: string) {
    const buf = edits[roomId];
    if (!buf) { setConfirm(null); return; }
    const updates: Record<string, any> = {};
    for (const f of ROOM_FIELDS) {
      let v: any = buf[f.col];
      if (f.nullable && (v === '' || v == null)) v = null;
      else if (f.money) v = typeof v === 'string' ? c(v) : v;
      else if (v !== null) v = Number(v);
      updates[f.col] = v;
    }
    updates.display_name = buf.display_name;
    updates.band_enabled = buf.band_enabled;
    updates.active = buf.active;
    const ok = await patch({ kind: 'room', id: roomId, updates });
    if (ok) { setEdits((e) => { const n = { ...e }; delete n[roomId]; return n; }); load(); setMsg('Saved.'); }
    setConfirm(null);
  }

  async function saveTier(tier: any, priceStr: string, perHourStr: string, label: string, note: string) {
    const ok = await patch({ kind: 'tier', id: tier.id, updates: { price_cents: c(priceStr), per_hour_cents: perHourStr === '' ? null : c(perHourStr), label, note } });
    if (ok) { load(); setMsg('Tier saved.'); }
  }
  async function saveSurcharge(s: any, amountStr: string, startStr: string, endStr: string) {
    const updates: Record<string, unknown> = { amount_cents: c(amountStr) };
    // Window only applies to time-based surcharges (late_night / deep_night).
    if (s.kind !== 'same_day') {
      updates.start_hour = startStr === '' ? null : Number(startStr);
      updates.end_hour = endStr === '' ? null : Number(endStr);
    }
    const ok = await patch({ kind: 'surcharge', id: s.id, updates });
    if (ok) { load(); setMsg('Surcharge saved.'); }
  }
  async function toggleEngineer(roomId: string, engineerId: string, assigned: boolean) {
    const ok = await patch({ kind: assigned ? 'unassign' : 'assign', roomId, engineerId });
    if (ok) load();
  }

  if (loading) return <div className="flex items-center gap-2 text-black/40 font-mono text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  if (!data) return <div className="font-mono text-sm text-red-600 py-8">Couldn&apos;t load studios.</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {msg && <div className="font-mono text-xs text-black/60">{msg}</div>}
      {data.rooms.map((room: any) => {
        const buf = roomBuf(room);
        const dirty = !!edits[room.id];
        const isOpen = open[room.id] ?? false;
        return (
          <div key={room.id} className="border-2 border-black/10">
            <button
              onClick={() => setOpen((o) => ({ ...o, [room.id]: !isOpen }))}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-black/[0.02]"
            >
              <div className="flex-1">
                <p className="font-mono text-sm font-bold">{room.display_name} <span className="text-black/40 font-normal">/{room.slug}</span></p>
                <p className="font-mono text-xs text-black/50 mt-0.5">
                  ${d(room.hourly_rate_cents)}/hr · {room.deposit_percent}% deposit · {room.band_enabled ? 'band ✓' : 'no band'} · {room.active ? 'active' : 'inactive'}
                </p>
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4 text-black/40" /> : <ChevronDown className="w-4 h-4 text-black/40" />}
            </button>

            {isOpen && (
              <div className="border-t-2 border-black/10 p-4 space-y-6">
                {/* Core room fields */}
                <div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Display name" full>
                      <input value={buf.display_name ?? ''} onChange={(e) => setRoomField(room.id, 'display_name', e.target.value)} className={inp} />
                    </Field>
                    {ROOM_FIELDS.map((f) => (
                      <Field key={f.col} label={f.label}>
                        <div className="flex items-center gap-1">
                          {f.money && <span className="font-mono text-xs text-black/40">$</span>}
                          <input
                            value={f.money ? (typeof buf[f.col] === 'string' ? buf[f.col] : d(buf[f.col])) : (buf[f.col] ?? '')}
                            onChange={(e) => setRoomField(room.id, f.col, e.target.value)}
                            inputMode="decimal"
                            className={inp}
                          />
                        </div>
                      </Field>
                    ))}
                  </div>
                  <div className="flex items-center gap-6 mt-3">
                    <Toggle label="Band enabled" value={!!buf.band_enabled} onChange={(v) => setRoomField(room.id, 'band_enabled', v)} />
                    <Toggle label="Active (bookable)" value={!!buf.active} onChange={(v) => setRoomField(room.id, 'active', v)} />
                  </div>
                  <button
                    disabled={!dirty || saving}
                    onClick={() => setConfirm({ roomId: room.id, name: room.display_name })}
                    className="mt-4 inline-flex items-center gap-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-accent/90 transition-colors disabled:opacity-40"
                  >
                    <Save className="w-3.5 h-3.5" /> Save room
                  </button>
                </div>

                {/* Pricing tiers */}
                {room.tiers.length > 0 && (
                  <div>
                    <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 mb-2">Pricing tiers</h4>
                    <div className="space-y-2">
                      {room.tiers.map((t: any) => <TierRow key={t.id} tier={t} onSave={saveTier} saving={saving} />)}
                    </div>
                  </div>
                )}

                {/* Surcharges */}
                {room.surcharges.length > 0 && (
                  <div>
                    <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 mb-2">Surcharges (per hour)</h4>
                    <div className="space-y-2">
                      {room.surcharges.map((s: any) => <SurchargeRow key={s.id} s={s} onSave={saveSurcharge} saving={saving} />)}
                    </div>
                  </div>
                )}

                {/* Engineers */}
                <div>
                  <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 mb-2">Assigned engineers</h4>
                  <div className="flex flex-wrap gap-2">
                    {data.roster.map((eng: any) => {
                      const assigned = room.engineerIds.includes(eng.id);
                      return (
                        <button
                          key={eng.id}
                          disabled={saving}
                          onClick={() => toggleEngineer(room.id, eng.id, assigned)}
                          className={`font-mono text-xs px-3 py-1.5 border-2 transition-colors disabled:opacity-50 ${assigned ? 'border-accent bg-accent/10 text-black' : 'border-black/15 text-black/40 hover:border-black/40'}`}
                        >
                          {assigned ? '✓ ' : '+ '}{eng.display_name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {data.globalSurcharges?.length > 0 && (
        <div className="border-2 border-black/10 p-4">
          <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 mb-2">Global surcharges (apply to all rooms)</h4>
          <div className="space-y-2">
            {data.globalSurcharges.map((s: any) => <SurchargeRow key={s.id} s={s} onSave={saveSurcharge} saving={saving} />)}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        tier="type-to-confirm"
        tone="warning"
        title={confirm ? `Update ${confirm.name} pricing?` : ''}
        confirmWord="CONFIRM"
        confirmLabel="Save changes"
        busy={saving}
        impact="This changes what every NEW booking for this room is charged (and what shows on /pricing and the booking flow). Existing bookings are not affected."
        onConfirm={() => { if (confirm) saveRoom(confirm.roomId); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

const inp = 'w-full border-2 border-black/15 px-2.5 py-1.5 font-mono text-sm focus:border-accent focus:outline-none';

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? 'bg-accent' : 'bg-black/20'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
      <span className="font-mono text-xs">{label}</span>
    </label>
  );
}

function TierRow({ tier, onSave, saving }: { tier: any; onSave: (t: any, p: string, ph: string, l: string, n: string) => void; saving: boolean }) {
  const [price, setPrice] = useState(d(tier.price_cents));
  const [perHour, setPerHour] = useState(d(tier.per_hour_cents));
  const [label, setLabel] = useState(tier.label ?? '');
  const [note, setNote] = useState(tier.note ?? '');
  const dirty = price !== d(tier.price_cents) || perHour !== d(tier.per_hour_cents) || label !== (tier.label ?? '') || note !== (tier.note ?? '');
  return (
    <div className="flex flex-wrap items-end gap-2 border border-black/10 p-2.5">
      <span className="font-mono text-[11px] font-bold uppercase text-black/50 w-16">{tier.kind}</span>
      <LabeledMini label="Price $"><input value={price} onChange={(e) => setPrice(e.target.value)} className={miniInp} /></LabeledMini>
      <LabeledMini label="$/hr"><input value={perHour} onChange={(e) => setPerHour(e.target.value)} className={miniInp} /></LabeledMini>
      <LabeledMini label="Label" wide><input value={label} onChange={(e) => setLabel(e.target.value)} className={miniInp} /></LabeledMini>
      <LabeledMini label="Note" wide><input value={note} onChange={(e) => setNote(e.target.value)} className={miniInp} /></LabeledMini>
      <button disabled={!dirty || saving} onClick={() => onSave(tier, price, perHour, label, note)} className="font-mono text-[11px] font-bold uppercase px-3 py-2 border-2 border-black hover:bg-black hover:text-white transition-colors disabled:opacity-30">Save</button>
    </div>
  );
}

function SurchargeRow({ s, onSave, saving }: { s: any; onSave: (s: any, amt: string, start: string, end: string) => void; saving: boolean }) {
  const [amt, setAmt] = useState(d(s.amount_cents));
  const [start, setStart] = useState(s.start_hour == null ? '' : String(s.start_hour));
  const [end, setEnd] = useState(s.end_hour == null ? '' : String(s.end_hour));
  const hasWindow = s.kind !== 'same_day';
  const dirty = amt !== d(s.amount_cents) || (hasWindow && (start !== (s.start_hour == null ? '' : String(s.start_hour)) || end !== (s.end_hour == null ? '' : String(s.end_hour))));
  return (
    <div className="flex items-end gap-2 border border-black/10 p-2.5 flex-wrap">
      <span className="font-mono text-[11px] font-bold uppercase text-black/50 flex-1 min-w-[80px]">{s.kind}</span>
      <LabeledMini label="Amount $/hr"><input value={amt} onChange={(e) => setAmt(e.target.value)} className={miniInp} /></LabeledMini>
      {hasWindow && <LabeledMini label="From (0-23)"><input value={start} onChange={(e) => setStart(e.target.value)} inputMode="decimal" className={miniInp} /></LabeledMini>}
      {hasWindow && <LabeledMini label="To (0-23)"><input value={end} onChange={(e) => setEnd(e.target.value)} inputMode="decimal" className={miniInp} /></LabeledMini>}
      <button disabled={!dirty || saving} onClick={() => onSave(s, amt, start, end)} className="font-mono text-[11px] font-bold uppercase px-3 py-2 border-2 border-black hover:bg-black hover:text-white transition-colors disabled:opacity-30">Save</button>
    </div>
  );
}

const miniInp = 'w-full border border-black/15 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none';
function LabeledMini({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'min-w-[120px] flex-1' : 'w-20'}>
      <label className="block font-mono text-[9px] uppercase tracking-wider text-black/40 mb-0.5">{label}</label>
      {children}
    </div>
  );
}
