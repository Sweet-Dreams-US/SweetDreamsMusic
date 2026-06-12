'use client';

// components/hub/RequestMoreModal.tsx
//
// Round E Phase 2: customer-facing modal to request more of any
// element of their package (extra hours, more beats, additional media).
// Submits to /api/packages/entitlements/[id]/addon-request, which
// notifies admins to generate a follow-up quote at the package's
// discount tier.
//
// Per Cole's locked-in design: this is a request-only flow. No
// instant fulfillment — admin reviews and either creates a small
// add-on quote (60-day window from issuance) or extends the
// membership term by an additional month if the request is large
// enough to warrant it.

import { useState } from 'react';
import { X, Loader2, Send, AlertCircle, CheckCircle2, Clock, Music, Film, Package } from 'lucide-react';

interface Entitlement {
  id: string;
  template_name: string;
  template_is_membership: boolean;
}

type RequestType = 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';

interface Props {
  entitlement: Entitlement;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function RequestMoreModal({ entitlement, onClose, onSubmitted }: Props) {
  const [requestType, setRequestType] = useState<RequestType>('studio_hours');
  const [quantity, setQuantity] = useState<number>(2);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setError(null);
    if (quantity <= 0) {
      setError('Quantity must be at least 1.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/packages/entitlements/${entitlement.id}/addon-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: requestType,
          quantity,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Could not submit request.');
        return;
      }
      setSuccess(true);
      // Show success state for 1.2s before closing.
      setTimeout(() => onSubmitted(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4 py-8">
        <div className="bg-white text-black w-full max-w-lg border-2 border-black">
          {/* Header */}
          <div className="border-b-2 border-black px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                Request More
              </p>
              <h2 className="font-bold text-base truncate">{entitlement.template_name}</h2>
            </div>
            <button onClick={onClose} className="text-black/40 hover:text-black" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          {success ? (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
              <p className="font-bold text-base mb-1">Request sent</p>
              <p className="font-mono text-xs text-black/65">
                Admin will review and reach out with a follow-up quote at your discount rate.
              </p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* Type picker */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                  What do you need more of?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <TypeBtn
                    icon={Clock}
                    label="Studio hours"
                    active={requestType === 'studio_hours'}
                    onClick={() => setRequestType('studio_hours')}
                  />
                  <TypeBtn
                    icon={Film}
                    label="Media work"
                    active={requestType === 'media_offering'}
                    onClick={() => setRequestType('media_offering')}
                  />
                  <TypeBtn
                    icon={Music}
                    label="Beat credits"
                    active={requestType === 'beat_credit'}
                    onClick={() => setRequestType('beat_credit')}
                  />
                  <TypeBtn
                    icon={Package}
                    label="Other"
                    active={requestType === 'custom'}
                    onClick={() => setRequestType('custom')}
                  />
                </div>
              </div>

              {/* Quantity */}
              {requestType !== 'media_offering' && (
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                    How many?
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                  />
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                  Note for admin {requestType === 'media_offering' || requestType === 'custom' ? '*' : '(optional)'}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={
                    requestType === 'studio_hours'
                      ? 'Any specifics? Engineer preference, target dates, etc.'
                      : requestType === 'media_offering'
                      ? 'Which media offering — music video, photo session, etc?'
                      : requestType === 'beat_credit'
                      ? 'Specific producers / vibes you want?'
                      : 'Describe what you need.'
                  }
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-y"
                />
              </div>

              {/* What happens next */}
              <div className="bg-black/[0.03] p-3 border-l-2 border-accent">
                <p className="font-mono text-[11px] text-black/65">
                  Admin gets notified, reviews your request, and sends a follow-up quote at the
                  same discounted rate as your {entitlement.template_is_membership ? 'membership' : 'package'}. Add-ons
                  have their own 60-day usage window from issuance.
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

          {/* Footer */}
          {!success && (
            <div className="border-t-2 border-black px-5 py-3 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border border-black/20 hover:border-black"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {busy ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Clock;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-xs font-bold uppercase tracking-wider px-3 py-2.5 inline-flex items-center justify-center gap-1.5 transition-colors ${
        active ? 'bg-black text-white' : 'border border-black/20 text-black/60 hover:border-black hover:text-black'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
