'use client';

// ConfirmDialog — the reusable "persuasion" modal for impactful admin changes.
// Two tiers:
//   - 'simple'          → one-click confirm (low impact: enabling a feature, minor edits)
//   - 'type-to-confirm' → Confirm stays disabled until the admin types `confirmWord`
//                          (high impact: disabling a feature, changing pricing / revenue shares)
// The caller owns what "confirm" does; this component only gates it. Designed to
// replace scattered window.confirm() calls across the admin surface.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

export type ConfirmTier = 'simple' | 'type-to-confirm';
export type ConfirmTone = 'default' | 'warning' | 'danger';

export interface ConfirmDialogProps {
  open: boolean;
  tier?: ConfirmTier;
  title: string;
  /** Plain-language business impact (string or nodes so $ / counts can be bolded). */
  impact: React.ReactNode;
  /** Optional concrete consequences list. */
  bullets?: string[];
  /** Optional persuasion callout shown above the actions (the "nudge"). */
  persuasion?: React.ReactNode;
  /** For 'type-to-confirm': the exact text the admin must type (case-sensitive). */
  confirmWord?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  tier = 'simple',
  title,
  impact,
  bullets,
  persuasion,
  confirmWord,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Reset the typed value whenever the dialog (re)opens.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  // Esc cancels; focus the right control on open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      if (tier === 'type-to-confirm') inputRef.current?.focus();
      else cancelRef.current?.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, tier, busy, onCancel]);

  if (!open) return null;

  const needsType = tier === 'type-to-confirm';
  const typedOk = !needsType || typed.trim() === (confirmWord ?? '').trim();
  const confirmDisabled = busy || !typedOk;

  const toneIcon = tone === 'default' ? Info : AlertTriangle;
  const ToneIcon = toneIcon;
  const toneColor =
    tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-black';
  const confirmBtn =
    tone === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700'
      : tone === 'warning'
        ? 'bg-amber-500 text-black hover:bg-amber-600'
        : 'bg-accent text-black hover:bg-accent/90';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        // Backdrop click cancels (ignore clicks bubbling from the card).
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md bg-white border-2 border-black font-mono shadow-xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b-2 border-black/10">
          <ToneIcon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${toneColor}`} />
          <h3 className="flex-1 text-sm font-bold uppercase tracking-wider">{title}</h3>
          <button
            onClick={() => !busy && onCancel()}
            aria-label="Close"
            className="text-black/30 hover:text-black transition-colors -mt-1 -mr-1 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          <div className="text-sm text-black/70 leading-relaxed">{impact}</div>

          {bullets && bullets.length > 0 && (
            <ul className="space-y-1.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-black/60">
                  <span className="text-black/30 mt-0.5">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {persuasion && (
            <div className="border-2 border-accent bg-accent/10 p-3 text-xs text-black/80 flex items-start gap-2">
              <Info className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
              <div className="flex-1">{persuasion}</div>
            </div>
          )}

          {needsType && (
            <div className="pt-1">
              <label className="block text-[11px] uppercase tracking-wider text-black/50 mb-1">
                Type <span className="font-bold text-black">{confirmWord}</span> to confirm
              </label>
              <input
                ref={inputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                className="w-full border-2 border-black/20 px-3 py-2.5 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
                placeholder={confirmWord}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-5 border-t-2 border-black/10">
          <button
            ref={cancelRef}
            onClick={() => !busy && onCancel()}
            disabled={busy}
            className="flex-1 border-2 border-black px-4 py-3 text-xs font-bold uppercase tracking-wider hover:bg-black/5 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => !confirmDisabled && onConfirm()}
            disabled={confirmDisabled}
            className={`flex-1 px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${confirmBtn}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
