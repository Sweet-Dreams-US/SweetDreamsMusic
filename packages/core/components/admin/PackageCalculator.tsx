'use client';

// components/admin/PackageCalculator.tsx
//
// Round B: the calculator UI. Modal-style editor for creating + editing
// package templates. The whole feature concept lives here:
//   • Build a basket (line items)
//   • See live retail valuation
//   • Set a selling price → discount % auto-computes
//   • See worker payout cost (full-rate, regardless of discount)
//   • See studio margin (selling price − payout = net) and break-even
//   • Save → POSTs to /api/admin/packages/templates (create) or
//     PATCHes to /api/admin/packages/templates/[id] (edit)
//
// The math comes from lib/packages.ts so the numbers always match what
// future endpoints + redemption code will compute. Don't duplicate
// pricing logic in this component.

import { useEffect, useState, useMemo } from 'react';
import { X, Plus, Trash2, Loader2, AlertCircle, Save, Clock, Film, Music, Package } from 'lucide-react';
import {
  computePackageMath,
  computeWorkerPayoutPreview,
  computeStudioMarginPreview,
  formatCents,
  formatPct,
  defaultPackageValueForLine,
  PACKAGE_HOUR_VALUE_CENTS,
  DEFAULT_BEAT_CREDIT_VALUE_CENTS,
  type PackageLineKind,
  type PackageLineInput,
} from '@/lib/packages';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

interface MediaOfferingLite {
  id: string;
  title: string;
  price_cents: number | null;
  is_active: boolean;
}

export interface PackageTemplateForEdit {
  id?: string;                       // undefined when creating
  name: string;
  description: string | null;
  audience: 'solo' | 'band';
  is_membership: boolean;
  duration_days: number | null;
  membership_months: number | null;
  price_cents: number;               // one-off: total. membership: per month.
  is_active: boolean;
  lines: EditableLine[];
}

interface EditableLine {
  /** Local-only key for React list identity. */
  localId: string;
  kind: PackageLineKind;
  quantity: number;
  full_price_cents: number;
  package_value_cents: number;
  media_offering_id: string | null;
  notes: string | null;
}

// Empty starter state — opens with a 3-month membership scaffolded with
// 4 hours of studio time. Admin tweaks from there. This default reflects
// the typical "artist starter pack" the studio has been quoting manually.
function blankTemplate(): PackageTemplateForEdit {
  return {
    name: '',
    description: '',
    audience: 'solo',
    is_membership: false,
    duration_days: 60,
    membership_months: 3,
    price_cents: 0,
    is_active: true,
    lines: [],
  };
}

let lineKeyCounter = 0;
function nextLocalId() {
  lineKeyCounter += 1;
  return `local-${Date.now()}-${lineKeyCounter}`;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

interface Props {
  /** undefined = create new. populated = edit existing. */
  initial?: PackageTemplateForEdit;
  onClose: () => void;
  onSaved: () => void;
}

export default function PackageCalculator({ initial, onClose, onSaved }: Props) {
  const [template, setTemplate] = useState<PackageTemplateForEdit>(
    initial ?? blankTemplate(),
  );
  const [offerings, setOfferings] = useState<MediaOfferingLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull active media offerings once on mount so the line picker can
  // surface "add this offering as a credit." Inactive offerings are
  // filtered — admin shouldn't bundle a retired product.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/media/offerings', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        const list = (body.offerings ?? []) as MediaOfferingLite[];
        setOfferings(list.filter((o) => o.is_active));
      } catch {
        // Non-fatal — admin can still build studio_hours / beat_credit / custom lines.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Live math ─────────────────────────────────────────────────────
  // Convert editable lines → the shape lib/packages helpers expect.
  const lineInputs: PackageLineInput[] = useMemo(
    () =>
      template.lines.map((l) => ({
        kind: l.kind,
        quantity: l.quantity,
        full_price_cents: l.full_price_cents,
        package_value_cents: l.package_value_cents,
        media_offering_id: l.media_offering_id,
        notes: l.notes,
      })),
    [template.lines],
  );

  // For memberships, the "selling price" the customer signs up for is
  // the total contract value (per-month × months). For one-offs, it's
  // just the price. Pass the right shape to the math helpers so the
  // discount % reflects what the customer actually pays vs retail.
  const grossRevenueCents = template.is_membership
    ? template.price_cents * (template.membership_months ?? 0)
    : template.price_cents;

  const math = useMemo(
    () => computePackageMath(lineInputs, grossRevenueCents),
    [lineInputs, grossRevenueCents],
  );
  const payout = useMemo(() => computeWorkerPayoutPreview(lineInputs), [lineInputs]);
  const margin = useMemo(
    () => computeStudioMarginPreview(lineInputs, grossRevenueCents),
    [lineInputs, grossRevenueCents],
  );

  // ── Mutators ──────────────────────────────────────────────────────

  function patchTemplate(p: Partial<PackageTemplateForEdit>) {
    setTemplate((t) => ({ ...t, ...p }));
  }

  function addLine(kind: PackageLineKind, presetOfferingId?: string) {
    let line: EditableLine;
    if (kind === 'studio_hours') {
      const qty = 4;
      line = {
        localId: nextLocalId(),
        kind,
        quantity: qty,
        full_price_cents: qty * PACKAGE_HOUR_VALUE_CENTS,
        package_value_cents: qty * PACKAGE_HOUR_VALUE_CENTS,
        media_offering_id: null,
        notes: 'Studio B rate, any room (Studio A pays surcharge at booking)',
      };
    } else if (kind === 'beat_credit') {
      line = {
        localId: nextLocalId(),
        kind,
        quantity: 1,
        full_price_cents: DEFAULT_BEAT_CREDIT_VALUE_CENTS,
        package_value_cents: DEFAULT_BEAT_CREDIT_VALUE_CENTS,
        media_offering_id: null,
        notes: 'Trackout lease tier',
      };
    } else if (kind === 'media_offering') {
      const offering = presetOfferingId
        ? offerings.find((o) => o.id === presetOfferingId)
        : offerings[0];
      const price = offering?.price_cents ?? 0;
      line = {
        localId: nextLocalId(),
        kind,
        quantity: 1,
        full_price_cents: price,
        package_value_cents: price,
        media_offering_id: offering?.id ?? null,
        notes: offering?.title ?? null,
      };
    } else {
      line = {
        localId: nextLocalId(),
        kind: 'custom',
        quantity: 1,
        full_price_cents: 0,
        package_value_cents: 0,
        media_offering_id: null,
        notes: 'Describe this line item',
      };
    }
    setTemplate((t) => ({ ...t, lines: [...t.lines, line] }));
  }

  function patchLine(localId: string, p: Partial<EditableLine>) {
    setTemplate((t) => ({
      ...t,
      lines: t.lines.map((l) => (l.localId === localId ? { ...l, ...p } : l)),
    }));
  }

  function removeLine(localId: string) {
    setTemplate((t) => ({ ...t, lines: t.lines.filter((l) => l.localId !== localId) }));
  }

  // When admin changes quantity on a studio_hours line, recompute the
  // retail price for them so they don't have to do the multiplication.
  // package_value defaults to retail unless they've already overridden it.
  function bumpStudioHoursQty(localId: string, newQty: number) {
    const line = template.lines.find((l) => l.localId === localId);
    if (!line) return;
    const newRetail = newQty * PACKAGE_HOUR_VALUE_CENTS;
    const valueWasDefault = line.package_value_cents === line.full_price_cents;
    patchLine(localId, {
      quantity: newQty,
      full_price_cents: newRetail,
      package_value_cents: valueWasDefault ? newRetail : line.package_value_cents,
    });
  }

  // ── Save ──────────────────────────────────────────────────────────

  async function save() {
    setError(null);
    if (!template.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (template.price_cents <= 0) {
      setError('Selling price must be > $0.');
      return;
    }
    if (template.lines.length === 0) {
      setError('Add at least one line item to the package.');
      return;
    }

    setSaving(true);
    try {
      const linesPayload = template.lines.map((l, idx) => ({
        kind: l.kind,
        quantity: l.quantity,
        full_price_cents: l.full_price_cents,
        package_value_cents: l.package_value_cents,
        media_offering_id: l.media_offering_id,
        notes: l.notes,
        sort_order: idx,
      }));
      const payload = {
        name: template.name.trim(),
        description: template.description?.trim() || null,
        audience: template.audience,
        is_membership: template.is_membership,
        duration_days: template.is_membership ? null : template.duration_days,
        membership_months: template.is_membership ? template.membership_months : null,
        price_cents: template.price_cents,
        is_active: template.is_active,
        lines: linesPayload,
      };

      const res = template.id
        ? await fetch(`/api/admin/packages/templates/${template.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/packages/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Save failed.');
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4 py-8">
        <div className="bg-white text-black w-full max-w-4xl border-2 border-black">
          {/* Header */}
          <div className="border-b-2 border-black px-6 py-4 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                {template.id ? 'Edit Template' : 'New Template'}
              </p>
              <h2 className="font-bold text-xl">
                {template.name || 'Untitled package'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-black/40 hover:text-black transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-6 space-y-8">
            {/* ── Basics ──────────────────────────────────────────── */}
            <section>
              <h3 className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-3">
                1 · Basics
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name *">
                  <input
                    type="text"
                    value={template.name}
                    onChange={(e) => patchTemplate({ name: e.target.value })}
                    className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                    placeholder="3-Month Artist Development"
                  />
                </Field>
                <Field label="Audience">
                  <div className="flex gap-2">
                    <SegmentBtn
                      active={template.audience === 'solo'}
                      onClick={() => patchTemplate({ audience: 'solo' })}
                    >
                      Solo
                    </SegmentBtn>
                    <SegmentBtn
                      active={template.audience === 'band'}
                      onClick={() => patchTemplate({ audience: 'band' })}
                    >
                      Band
                    </SegmentBtn>
                  </div>
                </Field>
              </div>

              <Field label="Description (shown to customer in quote)" className="mt-4">
                <textarea
                  value={template.description ?? ''}
                  onChange={(e) => patchTemplate({ description: e.target.value })}
                  rows={2}
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-y"
                  placeholder="A 3-month commitment for serious artists ready to build a body of work."
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <Field label="Shape">
                  <div className="flex gap-2">
                    <SegmentBtn
                      active={!template.is_membership}
                      onClick={() => patchTemplate({ is_membership: false })}
                    >
                      One-Off
                    </SegmentBtn>
                    <SegmentBtn
                      active={template.is_membership}
                      onClick={() => patchTemplate({ is_membership: true })}
                    >
                      Membership
                    </SegmentBtn>
                  </div>
                </Field>
                {template.is_membership ? (
                  <Field label="Membership length (months)">
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={template.membership_months ?? 3}
                      onChange={(e) =>
                        patchTemplate({ membership_months: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                    />
                  </Field>
                ) : (
                  <Field label="Validity window (days)">
                    <input
                      type="number"
                      min="1"
                      value={template.duration_days ?? 60}
                      onChange={(e) =>
                        patchTemplate({ duration_days: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                    />
                  </Field>
                )}
              </div>
            </section>

            {/* ── Lines ───────────────────────────────────────────── */}
            <section>
              <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                <h3 className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60">
                  2 · What's in the basket
                </h3>
                <div className="flex gap-1.5 flex-wrap">
                  <AddBtn icon={Clock} onClick={() => addLine('studio_hours')}>+ Hours</AddBtn>
                  <AddBtn icon={Film} onClick={() => addLine('media_offering')} disabled={offerings.length === 0}>+ Media</AddBtn>
                  <AddBtn icon={Music} onClick={() => addLine('beat_credit')}>+ Beats</AddBtn>
                  <AddBtn icon={Package} onClick={() => addLine('custom')}>+ Custom</AddBtn>
                </div>
              </div>

              {template.lines.length === 0 ? (
                <div className="border-2 border-dashed border-black/15 p-8 text-center">
                  <p className="font-mono text-xs text-black/45">
                    Empty basket. Add line items above.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {template.lines.map((line) => (
                    <LineEditor
                      key={line.localId}
                      line={line}
                      offerings={offerings}
                      onPatch={(p) => patchLine(line.localId, p)}
                      onPatchHours={(qty) => bumpStudioHoursQty(line.localId, qty)}
                      onRemove={() => removeLine(line.localId)}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* ── Pricing ─────────────────────────────────────────── */}
            <section>
              <h3 className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-3">
                3 · Pricing
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Field
                    label={
                      template.is_membership
                        ? 'Price per month *'
                        : 'Total selling price *'
                    }
                  >
                    <DollarsInput
                      cents={template.price_cents}
                      onChange={(v) => patchTemplate({ price_cents: v })}
                      autoFocus={false}
                    />
                  </Field>
                  {template.is_membership && (
                    <p className="font-mono text-[10px] text-black/55 mt-2">
                      Total contract value:{' '}
                      <span className="font-bold">{formatCents(grossRevenueCents)}</span>
                      {' '}({template.membership_months} months × {formatCents(template.price_cents)})
                    </p>
                  )}
                </div>

                {/* Math summary */}
                <div className="border-2 border-black/15 p-4 space-y-2">
                  <Row label="Retail value (sum of lines)" value={formatCents(math.totalFullPriceCents)} />
                  <Row
                    label="Customer pays"
                    value={formatCents(grossRevenueCents)}
                    accent
                  />
                  <Row
                    label="Discount absorbed by studio"
                    value={`${formatCents(math.totalDiscountCents)} (${formatPct(math.discountPct)})`}
                    warn={math.totalDiscountCents > 0}
                  />
                </div>
              </div>
            </section>

            {/* ── Worker payout + studio margin preview ──────────── */}
            <section>
              <h3 className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-3">
                4 · Payout + margin (if fully redeemed)
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border-2 border-black/15 p-4 space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-black/45 mb-2">
                    Worker payout cost
                  </p>
                  {payout.engineerCents > 0 && (
                    <Row label="Engineers (60% of session retail)" value={formatCents(payout.engineerCents)} />
                  )}
                  {payout.mediaWorkerCents > 0 && (
                    <Row label="Media workers (50% of media retail)" value={formatCents(payout.mediaWorkerCents)} />
                  )}
                  {payout.producerCents > 0 && (
                    <Row label="Producers (60% of beat retail)" value={formatCents(payout.producerCents)} />
                  )}
                  <div className="border-t border-black/10 pt-2 mt-2">
                    <Row label="Total worker cost" value={formatCents(payout.totalCents)} accent />
                  </div>
                </div>

                <div className="border-2 border-black/15 p-4 space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-black/45 mb-2">
                    Studio margin
                  </p>
                  <Row label="Customer pays" value={formatCents(margin.grossRevenueCents)} />
                  <Row label="Worker payout" value={`− ${formatCents(margin.workerPayoutCents)}`} />
                  <div className="border-t border-black/10 pt-2 mt-2">
                    <Row
                      label="Studio nets"
                      value={formatCents(margin.studioNetCents)}
                      accent={margin.studioNetCents > 0}
                      warn={margin.studioNetCents <= 0}
                    />
                  </div>
                  <p className="font-mono text-[10px] text-black/55 pt-2">
                    Margin loss vs retail:{' '}
                    <span className="font-bold">{formatCents(Math.max(0, margin.studioMarginLossVsRetailCents))}</span>
                  </p>
                  <p className="font-mono text-[10px] text-black/55">
                    Break-even price: <span className="font-bold">{formatCents(margin.breakEvenPriceCents)}</span>
                    {' '}({margin.breakEvenPriceCents > grossRevenueCents
                      ? 'YOU LOSE MONEY at current price'
                      : 'you profit above this'})
                  </p>
                </div>
              </div>
            </section>

            {/* ── Active toggle ───────────────────────────────────── */}
            <section>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={template.is_active}
                  onChange={(e) => patchTemplate({ is_active: e.target.checked })}
                  className="w-4 h-4 accent-accent"
                />
                <span className="font-mono text-xs">
                  Active — quotes can reference this template
                </span>
              </label>
            </section>

            {error && (
              <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                <p className="font-mono text-xs text-red-900">{error}</p>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="border-t-2 border-black px-6 py-4 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border border-black/20 hover:border-black"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? 'Saving…' : template.id ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function SegmentBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-[11px] uppercase tracking-wider font-bold px-3 py-2 transition-colors ${
        active ? 'bg-black text-white' : 'border border-black/20 text-black/60 hover:border-black hover:text-black'
      }`}
    >
      {children}
    </button>
  );
}

function AddBtn({
  icon: Icon,
  onClick,
  disabled,
  children,
}: {
  icon: typeof Clock;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-mono text-[10px] uppercase tracking-wider font-bold px-2.5 py-1.5 border border-black/30 hover:border-black inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Plus className="w-3 h-3" />
      <Icon className="w-3 h-3" />
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="font-mono text-[11px] text-black/65">{label}</span>
      <span
        className={`font-mono text-sm font-bold ${
          warn ? 'text-red-700' : accent ? 'text-accent' : 'text-black'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function DollarsInput({
  cents,
  onChange,
  autoFocus,
}: {
  cents: number;
  onChange: (cents: number) => void;
  autoFocus?: boolean;
}) {
  // Lightweight controlled input that reads dollars (with cents) and
  // writes integer cents back to caller. Avoids floating-point drift
  // by always converting through Math.round(× 100).
  const [text, setText] = useState((cents / 100).toFixed(2));
  useEffect(() => {
    setText((cents / 100).toFixed(2));
  }, [cents]);

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-black/50">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          // Accept partial typing ("1.", "1.5", etc.) without yanking.
          const parsed = parseFloat(raw);
          if (!Number.isNaN(parsed) && parsed >= 0) {
            onChange(Math.round(parsed * 100));
          } else if (raw === '' || raw === '.') {
            onChange(0);
          }
        }}
        onBlur={() => setText((cents / 100).toFixed(2))}
        className="w-full border-2 border-black pl-7 pr-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
      />
    </div>
  );
}

function LineEditor({
  line,
  offerings,
  onPatch,
  onPatchHours,
  onRemove,
}: {
  line: EditableLine;
  offerings: MediaOfferingLite[];
  onPatch: (p: Partial<EditableLine>) => void;
  onPatchHours: (qty: number) => void;
  onRemove: () => void;
}) {
  const Icon =
    line.kind === 'studio_hours' ? Clock :
    line.kind === 'media_offering' ? Film :
    line.kind === 'beat_credit' ? Music :
    Package;

  return (
    <li className="border-2 border-black/15 p-3">
      <div className="flex items-start gap-3">
        <Icon className="w-4 h-4 text-black/45 mt-1 shrink-0" />

        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
          {/* Quantity (and offering picker for media) */}
          {line.kind === 'studio_hours' && (
            <div className="md:col-span-2">
              <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-0.5">
                Hours
              </label>
              <input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(e) => onPatchHours(Math.max(1, Number(e.target.value) || 1))}
                className="w-full border border-black/20 px-2 py-1 font-mono text-xs bg-transparent focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {line.kind === 'beat_credit' && (
            <div className="md:col-span-2">
              <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-0.5">
                Beats
              </label>
              <input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(e) => onPatch({ quantity: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full border border-black/20 px-2 py-1 font-mono text-xs bg-transparent focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {line.kind === 'media_offering' && (
            <div className="md:col-span-5">
              <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-0.5">
                Offering
              </label>
              <select
                value={line.media_offering_id ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  const offering = offerings.find((o) => o.id === id);
                  const price = offering?.price_cents ?? 0;
                  onPatch({
                    media_offering_id: id || null,
                    full_price_cents: price,
                    package_value_cents: line.package_value_cents === line.full_price_cents
                      ? price
                      : line.package_value_cents,
                    notes: offering?.title ?? line.notes,
                  });
                }}
                className="w-full border border-black/20 px-2 py-1 font-mono text-xs bg-transparent focus:border-accent focus:outline-none"
              >
                <option value="">— pick —</option>
                {offerings.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            </div>
          )}

          {line.kind === 'custom' && (
            <div className="md:col-span-2">
              <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-0.5">
                Qty
              </label>
              <input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(e) => onPatch({ quantity: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full border border-black/20 px-2 py-1 font-mono text-xs bg-transparent focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {/* Notes / description */}
          <div className={line.kind === 'media_offering' ? 'md:col-span-3' : 'md:col-span-6'}>
            <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-0.5">
              Notes
            </label>
            <input
              type="text"
              value={line.notes ?? ''}
              onChange={(e) => onPatch({ notes: e.target.value })}
              placeholder={line.kind === 'custom' ? 'Describe this line item' : ''}
              className="w-full border border-black/20 px-2 py-1 font-mono text-xs bg-transparent focus:border-accent focus:outline-none"
            />
          </div>

          {/* Retail price (full price; auto-filled but editable for custom) */}
          <div className="md:col-span-2">
            <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-0.5">
              Retail
            </label>
            {line.kind === 'studio_hours' || line.kind === 'media_offering' ? (
              <p className="font-mono text-xs px-2 py-1 text-black/65">
                {formatCents(line.full_price_cents)}
              </p>
            ) : (
              <DollarsInputCompact
                cents={line.full_price_cents}
                onChange={(v) => {
                  // Update value too if it was auto-equal to retail.
                  const valueWasDefault = line.package_value_cents === line.full_price_cents;
                  onPatch({
                    full_price_cents: v,
                    package_value_cents: valueWasDefault ? v : line.package_value_cents,
                  });
                }}
              />
            )}
          </div>

          {/* Package value (admin override of contribution) */}
          <div className="md:col-span-2">
            <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-0.5">
              Pkg value
            </label>
            <DollarsInputCompact
              cents={line.package_value_cents}
              onChange={(v) => onPatch({ package_value_cents: v })}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="text-black/35 hover:text-red-600 transition-colors mt-1 shrink-0"
          aria-label="Remove line"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}

function DollarsInputCompact({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  useEffect(() => { setText((cents / 100).toFixed(2)); }, [cents]);
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-black/45">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const parsed = parseFloat(raw);
          if (!Number.isNaN(parsed) && parsed >= 0) {
            onChange(Math.round(parsed * 100));
          } else if (raw === '' || raw === '.') {
            onChange(0);
          }
        }}
        onBlur={() => setText((cents / 100).toFixed(2))}
        className="w-full border border-black/20 pl-5 pr-1 py-1 font-mono text-xs bg-transparent focus:border-accent focus:outline-none"
      />
    </div>
  );
}
