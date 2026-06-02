'use client';

// components/media/PackageBuilder.tsx
//
// Round 8c: admin's package editor. Embedded in the MediaOrders expanded
// panel. Lets admin:
//   • Pre-fill from the offering's configurator slots (when one exists)
//   • Add/remove/edit line items inline
//   • Save the draft (PUT)
//   • Send to buyer for review (POST /send)
//   • See per-line-item approval status when status === 'sent'
//
// All edits are live — saving any change writes the whole package back
// (truncate + re-insert line items). Audit log captures every save so
// history is preserved without versioning.

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, Send, Loader2, CheckCircle2, AlertCircle, Wand2, PackageCheck, ExternalLink } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';
import { formatCents } from '@/lib/utils';
import {
  type LineItemKind,
  type Package,
  LINE_ITEM_KINDS,
  LINE_ITEM_KIND_LABELS,
  computePackageTotalCents,
  lineItemTotalCents,
  packageNeedsPlanningCall,
} from '@/lib/media-packages';
import SessionScheduler from './SessionScheduler';

interface OfferingForFill {
  id: string;
  title: string;
  slug: string;
  price_cents: number | null;
  components: { slots?: Array<{ key: string; label: string; kind?: string; count?: number }> } | null;
}

interface DraftLineItem {
  id?: string;
  kind: LineItemKind;
  source_slot_key: string | null;
  label: string;
  qty: number;
  unit_cents: number;
  notes: string | null;
  approval_status?: 'pending' | 'approved' | 'rejected';
  // Round 8e: completion fields. Optional because draft items don't have them yet.
  completed?: boolean;
  completed_at?: string | null;
  drive_url?: string | null;
  notified_at?: string | null;
}

interface Props {
  bookingId: string;
  offering: OfferingForFill | null;
  /**
   * Buyer's original configurator selections — currently unused, but kept on the
   * Props shape so the parent can pass it without breaking. A future iteration
   * can use this to pre-fill line item notes (e.g. "shorts: premium tier") that
   * the buyer originally picked, instead of starting blank.
   */
  configuredComponents?: { selections?: Record<string, unknown> } | null;
  onChange?: () => void;
}

// Round 8e: per-line-item completion control. Admin marks done + pastes
// Drive URL → buyer gets emailed once (notified_at idempotency stamp).
function LineItemCompletion({
  bookingId,
  item,
  onSaved,
}: {
  bookingId: string;
  item: DraftLineItem;
  onSaved: () => void;
}) {
  const [drive, setDrive] = useState(item.drive_url ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (completed: boolean) => {
    if (!item.id) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/media/bookings/${bookingId}/line-items/${item.id}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            completed,
            drive_url: drive.trim() || undefined,
            notify_buyer: completed,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) setErr(data.error ?? 'Failed.');
      else onSaved();
    } catch {
      setErr('Network error.');
    } finally {
      setBusy(false);
    }
  };

  if (!item.id) return null;
  const isDone = !!item.completed;

  return (
    <div className="border-t border-black/5 pt-1.5 mt-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-wider text-black/50">
          Delivery
        </span>
        <input
          type="url"
          placeholder="Google Drive URL"
          value={drive}
          onChange={(e) => setDrive(e.target.value)}
          className="flex-1 min-w-0 border border-black/20 px-2 py-0.5 font-mono text-[11px]"
        />
        {isDone ? (
          <button
            onClick={() => submit(false)}
            disabled={busy}
            className="border border-black/20 hover:border-black font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 transition-colors disabled:opacity-50"
            title="Reopen — un-marks complete"
          >
            Reopen
          </button>
        ) : (
          <button
            onClick={() => submit(true)}
            disabled={busy || !drive.trim()}
            className="bg-green-700 text-white font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 hover:bg-green-800 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <PackageCheck className="w-2.5 h-2.5" />}
            Mark complete
          </button>
        )}
        {item.notified_at && (
          <span className="font-mono text-[9px] uppercase tracking-wider text-green-700">
            ✉ buyer notified
          </span>
        )}
        {item.completed_at && (
          <span className="font-mono text-[9px] text-black/50">
            done {fmtStampDate(item.completed_at)}
          </span>
        )}
        {item.drive_url && (
          <a
            href={item.drive_url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-wider text-accent hover:underline inline-flex items-center gap-0.5"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            open
          </a>
        )}
      </div>
      {err && (
        <p className="font-mono text-[10px] text-red-700 mt-0.5">{err}</p>
      )}
    </div>
  );
}

export default function PackageBuilder({
  bookingId,
  offering,
  configuredComponents,
  onChange,
}: Props) {
  const [pkg, setPkg] = useState<Package | null>(null);
  const [items, setItems] = useState<DraftLineItem[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/media/bookings/${bookingId}/package`, { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load package.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.package) {
        setPkg(data.package);
        setItems(data.line_items as DraftLineItem[]);
        setNotes(data.package.notes ?? '');
      } else {
        setPkg(null);
        setItems([]);
        setNotes('');
      }
      setDirty(false);
      setError(null);
    } catch {
      setError('Network error loading package.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const updateItem = (i: number, patch: Partial<DraftLineItem>) => {
    setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    setDirty(true);
  };
  const addItem = () => {
    setItems((cur) => [
      ...cur,
      { kind: 'other', source_slot_key: null, label: '', qty: 1, unit_cents: 0, notes: null },
    ]);
    setDirty(true);
  };
  const removeItem = (i: number) => {
    setItems((cur) => cur.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  // Pre-fill from offering's configurator slots. Doesn't overwrite if items
  // already exist — admin clicks the explicit button when they want a fresh
  // structure. Prices default to 0; admin scopes them after the planning call.
  const autoFillFromOffering = () => {
    if (!offering) return;
    const slots = offering.components?.slots ?? [];
    const seeded: DraftLineItem[] = [];

    if (slots.length === 0 && offering.price_cents) {
      // Standalone offering — single line item.
      seeded.push({
        kind: 'other',
        source_slot_key: null,
        label: offering.title,
        qty: 1,
        unit_cents: offering.price_cents,
        notes: null,
      });
    } else {
      for (const slot of slots) {
        seeded.push({
          kind: mapSlotKindToLineItemKind(slot.key, slot.kind),
          source_slot_key: slot.key,
          label: slot.label,
          qty: typeof slot.count === 'number' && slot.count > 0 ? slot.count : 1,
          unit_cents: 0,
          notes: null,
        });
      }
    }
    setItems(seeded);
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      // Client-side line item validation matches the API.
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.label.trim()) {
          setError(`Line ${i + 1}: label required`);
          setSaving(false);
          return false;
        }
        if (it.qty < 1 || !Number.isInteger(it.qty)) {
          setError(`Line ${i + 1}: qty must be a positive whole number`);
          setSaving(false);
          return false;
        }
      }

      const res = await fetch(`/api/media/bookings/${bookingId}/package`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notes.trim() || null,
          line_items: items.map((it, idx) => ({
            kind: it.kind,
            source_slot_key: it.source_slot_key,
            label: it.label.trim(),
            qty: it.qty,
            unit_cents: it.unit_cents,
            notes: it.notes,
            sort_order: idx,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Save failed.');
        setSaving(false);
        return false;
      }
      setPkg(data.package as Package);
      setItems(data.line_items as DraftLineItem[]);
      setDirty(false);
      onChange?.();
      return true;
    } catch {
      setError('Network error saving.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sendToBuyer = async () => {
    if (sending) return;
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/bookings/${bookingId}/package/send`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Send failed.');
      } else {
        await load();
        onChange?.();
      }
    } catch {
      setError('Network error sending.');
    } finally {
      setSending(false);
    }
  };

  const total = computePackageTotalCents(
    items.map((it) => ({ total_cents: lineItemTotalCents(it.qty, it.unit_cents) })),
  );
  const planningCallNeeded = packageNeedsPlanningCall(items);
  const hasPlanningCall = items.some((it) => it.kind === 'planning_call');
  const approvedCount = items.filter((it) => it.approval_status === 'approved').length;

  if (loading) {
    return (
      <div className="border-2 border-dashed border-black/10 p-4 text-center">
        <Loader2 className="w-4 h-4 animate-spin mx-auto text-black/40" />
        <p className="font-mono text-xs text-black/40 mt-2">Loading package…</p>
      </div>
    );
  }

  return (
    <div className="border-2 border-black/10 bg-white">
      <div className="bg-black text-white px-4 py-2 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-wider font-bold">
          Final package
        </p>
        <span className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 ${
          pkg?.status === 'approved' ? 'bg-green-200 text-green-900' :
          pkg?.status === 'sent' ? 'bg-yellow-200 text-yellow-900' :
          'bg-white/20 text-white'
        }`}>
          {pkg?.status ?? 'no package yet'}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-900 font-mono text-xs px-3 py-2 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {!pkg && items.length === 0 && (
          <div className="text-center py-3">
            <p className="font-mono text-xs text-black/60 mb-2">
              No package yet. Pre-fill from the offering or build from scratch.
            </p>
            {offering && (
              <button
                onClick={autoFillFromOffering}
                className="bg-black text-white font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-1"
              >
                <Wand2 className="w-3 h-3" />
                Pre-fill from {offering.title}
              </button>
            )}
          </div>
        )}

        {pkg?.status === 'sent' && (
          <p className="font-mono text-[11px] text-black/60">
            Sent to buyer {pkg.proposed_at && `on ${fmtStampDate(pkg.proposed_at)}`}.
            {' '}<strong>{approvedCount} of {items.length}</strong> line items approved.
          </p>
        )}
        {pkg?.status === 'approved' && (
          <p className="font-mono text-[11px] text-green-700 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approved {pkg.approved_at && `on ${fmtStampDate(pkg.approved_at)}`} — package locked.
          </p>
        )}

        <div>
          <label className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1 block">
            Package notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
            rows={2}
            placeholder="Intro / terms shown to buyer above the line items"
            disabled={pkg?.status === 'approved'}
            className="w-full border border-black/20 px-2 py-1 font-mono text-xs disabled:bg-black/5"
          />
        </div>

        {planningCallNeeded && !hasPlanningCall && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 font-mono text-[11px] px-3 py-2">
            ⚠ This package includes a music video or {'>'} 2 shorts — a planning_call line
            item will be auto-added on save.
          </div>
        )}

        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="space-y-1.5">
              <LineItemRow
                item={it}
                locked={pkg?.status === 'approved'}
                onUpdate={(patch) => updateItem(i, patch)}
                onRemove={() => removeItem(i)}
              />
              {/* Round 8d: scheduling shows once the line item has been
                  saved (has an id). Unsaved drafts skip — admin saves
                  first, then schedules. */}
              {it.id && (
                <SessionScheduler
                  bookingId={bookingId}
                  lineId={it.id}
                  lineLabel={it.label}
                  defaultKind={defaultSessionKindFor(it.kind)}
                />
              )}
              {/* Round 8e: per-line completion + Drive URL (admin only).
                  Buyer gets emailed once when first marked complete with
                  a Drive URL — notified_at stamps idempotency. */}
              {it.id && (
                <LineItemCompletion
                  bookingId={bookingId}
                  item={it}
                  onSaved={load}
                />
              )}
            </div>
          ))}
        </div>

        <button
          onClick={addItem}
          disabled={pkg?.status === 'approved'}
          className="w-full border-2 border-dashed border-black/20 hover:border-black font-mono text-xs px-3 py-2 transition-colors flex items-center justify-center gap-1 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          Add line item
        </button>

        <div className="flex items-center justify-between border-t border-black/10 pt-3">
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50">
            Total
          </p>
          <p className="font-mono text-lg font-bold tabular-nums">{formatCents(total)}</p>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={save}
            disabled={!dirty || saving || pkg?.status === 'approved'}
            className="bg-black text-white font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 hover:bg-accent hover:text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save draft
          </button>
          <button
            onClick={sendToBuyer}
            disabled={sending || items.length === 0 || pkg?.status === 'approved'}
            className="bg-accent text-black font-mono text-[11px] uppercase tracking-wider font-bold px-3 py-1.5 hover:bg-black hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {pkg?.status === 'sent' ? 'Re-send to buyer' : 'Send to buyer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineItemRow({
  item,
  locked,
  onUpdate,
  onRemove,
}: {
  item: DraftLineItem;
  locked: boolean;
  onUpdate: (patch: Partial<DraftLineItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-black/10 bg-black/[0.02] p-2 space-y-1.5">
      <div className="flex gap-2">
        <select
          value={item.kind}
          onChange={(e) => onUpdate({ kind: e.target.value as LineItemKind })}
          disabled={locked}
          className="border border-black/20 px-2 py-1 font-mono text-[11px] disabled:bg-black/5"
        >
          {LINE_ITEM_KINDS.map((k) => (
            <option key={k} value={k}>{LINE_ITEM_KIND_LABELS[k]}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Label (e.g. '5 shorts, premium tier')"
          value={item.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          disabled={locked}
          className="flex-1 border border-black/20 px-2 py-1 font-mono text-xs disabled:bg-black/5"
        />
        <button
          onClick={onRemove}
          disabled={locked}
          className="text-black/40 hover:text-red-700 disabled:opacity-30"
          title="Remove"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex gap-2 items-center">
        <label className="font-mono text-[10px] uppercase tracking-wider text-black/50">Qty</label>
        <input
          type="number"
          min={1}
          value={item.qty}
          onChange={(e) => onUpdate({ qty: Math.max(1, parseInt(e.target.value) || 1) })}
          disabled={locked}
          className="w-16 border border-black/20 px-2 py-1 font-mono text-xs disabled:bg-black/5"
        />
        <label className="font-mono text-[10px] uppercase tracking-wider text-black/50">Unit $</label>
        <input
          type="number"
          min={0}
          step="0.01"
          value={(item.unit_cents / 100).toFixed(2)}
          onChange={(e) =>
            onUpdate({ unit_cents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)) })
          }
          disabled={locked}
          className="w-24 border border-black/20 px-2 py-1 font-mono text-xs disabled:bg-black/5"
        />
        <span className="font-mono text-xs text-black/60 ml-auto tabular-nums">
          = {formatCents(lineItemTotalCents(item.qty, item.unit_cents))}
        </span>
        {item.approval_status && (
          <span
            className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 ${
              item.approval_status === 'approved'
                ? 'bg-green-100 text-green-900'
                : item.approval_status === 'rejected'
                ? 'bg-red-100 text-red-900'
                : 'bg-black/10 text-black/60'
            }`}
          >
            {item.approval_status}
          </span>
        )}
      </div>
      <input
        type="text"
        placeholder="Notes (optional, shown to buyer)"
        value={item.notes ?? ''}
        onChange={(e) => onUpdate({ notes: e.target.value || null })}
        disabled={locked}
        className="w-full border border-black/20 px-2 py-1 font-mono text-[11px] disabled:bg-black/5"
      />
    </div>
  );
}

// Map an offering slot key/kind to the closest LineItemKind for auto-fill.
// Conservative — defaults to 'other' so admin can correct.
function mapSlotKindToLineItemKind(key: string, kind?: string): LineItemKind {
  const k = key.toLowerCase();
  if (k.includes('cover')) return 'cover_art';
  if (k.includes('short')) return 'shorts';
  if (k.includes('music_video') || k.includes('video')) return 'music_video';
  if (k.includes('photo')) return 'photo_session';
  if (k.includes('mix')) return 'mixing_session';
  if (k.includes('record')) return 'recording_session';
  if (kind === 'hours') return 'recording_session';
  return 'other';
}

// Map LineItemKind → default session_kind for the proposal form (Round 8d).
function defaultSessionKindFor(kind: LineItemKind): string {
  switch (kind) {
    case 'planning_call': return 'planning_call';
    case 'cover_art': return 'design_meeting';
    case 'shorts': return 'filming_external';
    case 'music_video': return 'filming_external';
    case 'photo_session': return 'photo_shoot';
    case 'filming_external': return 'filming_external';
    case 'mixing_session': return 'mixing_session';
    case 'design_meeting': return 'design_meeting';
    case 'recording_session': return 'recording_session';
    default: return 'other';
  }
}
