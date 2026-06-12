'use client';

// components/admin/MediaCatalog.tsx
//
// Admin CRUD for `media_offerings`. Lists every row (active + inactive),
// lets admin edit pricing / eligibility / sort order / activation inline,
// and exposes "Create new offering" as a popover form.
//
// Scope discipline: this component touches the `components` JSONB only via
// a raw textarea. A polished slot/severity editor is its own UI project and
// the seed data is already correct — admin can drop into Supabase or paste
// JSON for the edge cases. We surface a JSON validity check so a bad paste
// doesn't crash the catalog.
//
// Backward compatibility: this is a NEW admin tab; nothing in the catalog
// pages reads from anywhere this component writes that wasn't already
// readable. RLS + the public/active filter are unchanged.

import { useEffect, useState } from 'react';
import { Plus, Pencil, X, Save, RotateCcw, AlertCircle } from 'lucide-react';
import type { MediaOffering, MediaOfferingEligibility, MediaOfferingKind } from '@/lib/media';
import { formatCents } from '@/lib/utils';

const ELIGIBILITY_OPTS: MediaOfferingEligibility[] = [
  'solo',
  'band',
  'both',
  'band-by-request',
];
const KIND_OPTS: MediaOfferingKind[] = ['standalone', 'package'];

export default function MediaCatalog() {
  const [offerings, setOfferings] = useState<MediaOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/media/offerings', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setOfferings(data.offerings || []);
    } catch (e) {
      console.error('[admin-media-catalog] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Media Catalog</h2>
          <p className="font-mono text-xs text-black/50">
            Pricing + eligibility for the Media Hub. Edits go live the moment you save.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2"
        >
          <Plus className="w-3 h-3" />
          New offering
        </button>
      </div>

      {creating && (
        <div className="mb-6">
          <OfferingForm
            mode="create"
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              refresh();
            }}
          />
        </div>
      )}

      {loading ? (
        <p className="font-mono text-sm text-black/50">Loading…</p>
      ) : offerings.length === 0 ? (
        <p className="font-mono text-sm text-black/50">No offerings yet — create one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left font-mono text-[11px] uppercase tracking-wider text-black/50">
                <th className="py-2 pr-4">Sort</th>
                <th className="py-2 pr-4">Title / Slug</th>
                <th className="py-2 pr-4">Kind</th>
                <th className="py-2 pr-4">Eligibility</th>
                <th className="py-2 pr-4">Price</th>
                <th className="py-2 pr-4">Hours</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {offerings.map((o) => {
                const isEditing = editingId === o.id;
                if (isEditing) {
                  return (
                    <tr key={o.id} className="border-b border-black/10">
                      <td colSpan={8} className="py-3">
                        <OfferingForm
                          mode="edit"
                          existing={o}
                          onCancel={() => setEditingId(null)}
                          onSaved={() => {
                            setEditingId(null);
                            refresh();
                          }}
                        />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={o.id}
                    className={`border-b border-black/5 ${
                      o.is_active ? '' : 'bg-black/[0.02] text-black/50'
                    }`}
                  >
                    <td className="py-3 pr-4 font-mono text-xs">{o.sort_order}</td>
                    <td className="py-3 pr-4">
                      <p className="font-bold">{o.title}</p>
                      <p className="font-mono text-[11px] text-black/50">{o.slug}</p>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs capitalize">{o.kind}</td>
                    <td className="py-3 pr-4 font-mono text-xs">{o.eligibility}</td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {priceLabel(o)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {o.studio_hours_included || '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 ${
                          o.is_active
                            ? 'bg-accent/20 text-black'
                            : 'bg-black/10 text-black/50'
                        }`}
                      >
                        {o.is_active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingId(o.id)}
                        className="font-mono text-xs text-black/60 hover:text-black inline-flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function priceLabel(o: MediaOffering): string {
  if (o.price_cents != null) return formatCents(o.price_cents);
  if (o.price_range_low_cents != null && o.price_range_high_cents != null) {
    return `${formatCents(o.price_range_low_cents)} – ${formatCents(o.price_range_high_cents)}`;
  }
  return 'Inquire';
}

// ============================================================
// Inline create / edit form
// ============================================================

function OfferingForm({
  mode,
  existing,
  onCancel,
  onSaved,
}: {
  mode: 'create' | 'edit';
  existing?: MediaOffering;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Default state pulls from existing row when editing, blanks when creating.
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [publicBlurb, setPublicBlurb] = useState(existing?.public_blurb ?? '');
  const [kind, setKind] = useState<MediaOfferingKind>(existing?.kind ?? 'standalone');
  const [eligibility, setEligibility] = useState<MediaOfferingEligibility>(
    existing?.eligibility ?? 'both',
  );
  const [priceCents, setPriceCents] = useState(
    existing?.price_cents != null ? String(existing.price_cents / 100) : '',
  );
  const [priceLow, setPriceLow] = useState(
    existing?.price_range_low_cents != null
      ? String(existing.price_range_low_cents / 100)
      : '',
  );
  const [priceHigh, setPriceHigh] = useState(
    existing?.price_range_high_cents != null
      ? String(existing.price_range_high_cents / 100)
      : '',
  );
  const [hours, setHours] = useState(String(existing?.studio_hours_included ?? 0));
  const [sortOrder, setSortOrder] = useState(String(existing?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  const [componentsText, setComponentsText] = useState(
    existing?.components ? JSON.stringify(existing.components, null, 2) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dollarsToCents = (s: string): number | null => {
    if (s.trim() === '') return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };

  async function save() {
    setError(null);

    // Components validation — empty string means "no components" (NULL),
    // otherwise it must be valid JSON with a `slots` array. Any other shape
    // we let through so admins can experiment, but null/empty are special.
    let componentsJson: unknown = null;
    if (componentsText.trim() !== '') {
      try {
        componentsJson = JSON.parse(componentsText);
      } catch {
        setError('Components is not valid JSON');
        return;
      }
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      public_blurb: publicBlurb.trim() || null,
      kind,
      eligibility,
      price_cents: dollarsToCents(priceCents),
      price_range_low_cents: dollarsToCents(priceLow),
      price_range_high_cents: dollarsToCents(priceHigh),
      studio_hours_included: Number(hours) || 0,
      sort_order: Number(sortOrder) || 0,
      is_active: isActive,
      components: componentsJson,
    };
    if (mode === 'create') {
      payload.slug = slug.trim();
      if (!payload.slug || !payload.title) {
        setError('Slug and title required');
        return;
      }
    }

    setSaving(true);
    try {
      const res =
        mode === 'create'
          ? await fetch('/api/admin/media/offerings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/admin/media/offerings/${existing!.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Save failed');
        setSaving(false);
        return;
      }
      onSaved();
    } catch (e) {
      console.error('[admin-media-catalog] save error:', e);
      setError('Network error — try again');
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!existing || mode !== 'edit') return;
    if (!confirm(`Hide "${existing.title}" from the catalog? Existing bookings keep working.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/media/offerings/${existing.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Could not deactivate');
        setSaving(false);
        return;
      }
      onSaved();
    } catch (e) {
      console.error('[admin-media-catalog] deactivate error:', e);
      setError('Network error — try again');
      setSaving(false);
    }
  }

  return (
    <div className="bg-black/[0.02] border-2 border-black/10 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-wider font-bold">
          {mode === 'create' ? 'New offering' : `Edit · ${existing!.title}`}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-black/50 hover:text-black"
          aria-label="Cancel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {mode === 'create' && (
          <Field label="Slug (immutable after create)">
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="package-cool-thing"
              className={inputCls}
            />
          </Field>
        )}
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MediaOfferingKind)}
            className={inputCls}
          >
            {KIND_OPTS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Eligibility">
          <select
            value={eligibility}
            onChange={(e) => setEligibility(e.target.value as MediaOfferingEligibility)}
            className={inputCls}
          >
            {ELIGIBILITY_OPTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price ($, leave blank for range/inquire)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={priceCents}
            onChange={(e) => setPriceCents(e.target.value)}
            placeholder="850"
            className={inputCls}
          />
        </Field>
        <Field label="Studio hours included">
          <input
            type="number"
            min={0}
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Range low ($, optional)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={priceLow}
            onChange={(e) => setPriceLow(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Range high ($, optional)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={priceHigh}
            onChange={(e) => setPriceHigh(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Active in catalog">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Visible to buyers
          </label>
        </Field>
      </div>

      <Field label="Public blurb (shown on /media)">
        <textarea
          value={publicBlurb}
          onChange={(e) => setPublicBlurb(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </Field>

      <Field label="Components JSON (slot schema for packages — leave blank for standalones)">
        <textarea
          value={componentsText}
          onChange={(e) => setComponentsText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder='{"slots":[{"key":"cover_art","kind":"unit","label":"Cover art","skippable":true,"skip_delta_cents":15000}]}'
          className={`${inputCls} font-mono text-xs`}
        />
      </Field>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-xs text-black/60 hover:text-black"
          >
            Cancel
          </button>
        </div>
        {mode === 'edit' && existing?.is_active && (
          <button
            type="button"
            onClick={deactivate}
            disabled={saving}
            className="font-mono text-xs text-black/60 hover:text-red-700 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Deactivate
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full bg-white border-2 border-black/15 px-3 py-2 text-sm focus:border-black outline-none';
