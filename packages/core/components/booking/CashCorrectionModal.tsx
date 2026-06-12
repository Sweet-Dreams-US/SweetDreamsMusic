'use client';

// components/booking/CashCorrectionModal.tsx
//
// Reusable modal for correcting the cash collected on a completed
// booking. Used in both engineer dashboard (engineer corrects own
// session) and admin booking detail (admin can correct any cash
// session). The endpoint authorizes per role.

import { useState } from 'react';
import { X, Loader2, AlertCircle, CheckCircle2, DollarSign } from 'lucide-react';

interface Props {
  bookingId: string;
  customerName: string;
  currentTotalCents: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function CashCorrectionModal({
  bookingId,
  customerName,
  currentTotalCents,
  onClose,
  onSaved,
}: Props) {
  const [newAmountStr, setNewAmountStr] = useState((currentTotalCents / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setError(null);
    const parsed = parseFloat(newAmountStr);
    if (Number.isNaN(parsed) || parsed < 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Reason must be at least 5 characters — admin needs context.');
      return;
    }
    const newCents = Math.round(parsed * 100);
    if (newCents === currentTotalCents) {
      setError('Same as current amount — nothing to change.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/booking/${bookingId}/correct-cash`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_total_cents: newCents,
          reason: reason.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Save failed.');
        return;
      }
      setSuccess(true);
      setTimeout(() => onSaved(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white text-black w-full max-w-md border-2 border-black">
        <div className="border-b-2 border-black px-5 py-3 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
              Correct cash collected
            </p>
            <h2 className="font-bold text-base truncate">{customerName}</h2>
          </div>
          <button onClick={onClose} className="text-black/40 hover:text-black"><X className="w-4 h-4" /></button>
        </div>

        {success ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
            <p className="font-bold text-base mb-1">Correction saved</p>
            <p className="font-mono text-xs text-black/65">
              Audit log entry created. Admin will see this in the cash corrections log.
            </p>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Current */}
            <div className="bg-black/[0.03] p-3 border-l-2 border-black/20">
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/55 mb-1">
                Current total
              </p>
              <p className="font-bold text-lg">${(currentTotalCents / 100).toFixed(2)}</p>
            </div>

            {/* New amount */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                Actual cash collected
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/45" />
                <input
                  type="text"
                  inputMode="decimal"
                  value={newAmountStr}
                  onChange={(e) => setNewAmountStr(e.target.value)}
                  className="w-full border-2 border-black pl-9 pr-3 py-2 font-mono text-base bg-transparent focus:border-accent focus:outline-none"
                  autoFocus
                />
              </div>
              {parseFloat(newAmountStr) >= 0 && (
                <p className="font-mono text-[10px] text-black/55 mt-1">
                  Difference: ${((parseFloat(newAmountStr) * 100 - currentTotalCents) / 100).toFixed(2)}
                </p>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                Reason (required) <span className="text-black/40 normal-case">— admin sees this</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Customer ended early after 1 hour. Late night fee + 1 hour = $70."
                className="w-full border-2 border-black px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none resize-y"
              />
            </div>

            {/* Audit notice */}
            <div className="bg-accent/10 border-l-2 border-accent p-2.5">
              <p className="font-mono text-[10px] text-black/70">
                Every correction is logged with your email + timestamp. Admin reviews periodically.
              </p>
            </div>

            {error && (
              <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                <p className="font-mono text-xs text-red-900">{error}</p>
              </div>
            )}
          </div>
        )}

        {!success && (
          <div className="border-t-2 border-black px-5 py-3 flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border border-black/20 hover:border-black"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {busy ? 'Saving…' : 'Save Correction'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
