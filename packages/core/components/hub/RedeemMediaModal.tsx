'use client';

// components/hub/RedeemMediaModal.tsx
//
// Round G2: customer redeems a specific media_offering balance to
// kick off a media production order. Unlike beats (instant claim),
// media bookings need scheduling/coordination — admin sees the
// 'deposited' booking in the normal media queue and works through
// the production flow.

import { useState } from 'react';
import { X, Loader2, AlertCircle, CheckCircle2, Film } from 'lucide-react';

interface MediaBalance {
  id: string;
  notes: string | null;
  full_price_cents: number;
  quantity_granted: number;
  quantity_redeemed: number;
}

interface Props {
  entitlementId: string;
  templateName: string;
  balance: MediaBalance;
  onClose: () => void;
  onRedeemed: () => void;
}

export default function RedeemMediaModal({ entitlementId, templateName, balance, onClose, onRedeemed }: Props) {
  const [projectTitle, setProjectTitle] = useState('');
  const [projectVision, setProjectVision] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const remaining = balance.quantity_granted - balance.quantity_redeemed;

  async function submit() {
    setError(null);
    if (!projectTitle.trim()) {
      setError('Give the project a title so admin can find it.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/packages/entitlements/${entitlementId}/redeem-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          balance_id: balance.id,
          project_details: {
            title: projectTitle.trim(),
            vision: projectVision.trim() || null,
          },
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Redeem failed.');
        return;
      }
      setSuccess(true);
      setTimeout(() => onRedeemed(), 1500);
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
          <div className="border-b-2 border-black px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Redeem Media</p>
              <h2 className="font-bold text-base truncate">{templateName}</h2>
              <p className="font-mono text-[10px] text-black/55 truncate">
                {balance.notes ?? 'Media offering'} · {remaining} of {balance.quantity_granted} left
              </p>
            </div>
            <button onClick={onClose} className="text-black/40 hover:text-black"><X className="w-4 h-4" /></button>
          </div>

          {success ? (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
              <p className="font-bold text-base mb-1">Project kicked off</p>
              <p className="font-mono text-xs text-black/65">
                Admin sees this in the media queue. Production team will reach out within 1 business day.
              </p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              <div className="bg-black/[0.03] border-l-2 border-accent px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-black/45 mb-1">
                  How this works
                </p>
                <p className="font-mono text-[11px] text-black/70">
                  This kicks off a production order. The package covered the cost — production schedules with you, delivers per the offering's normal terms.
                </p>
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                  Project title *
                </label>
                <input
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Music video for 'Dreams'"
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                  Project vision (optional)
                </label>
                <textarea
                  value={projectVision}
                  onChange={(e) => setProjectVision(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="What you're making, who it's for, the feel."
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-y"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                  Anything else for production?
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="References, locations, tight deadlines, etc."
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-y"
                />
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
            <div className="border-t-2 border-black px-5 py-3 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border border-black/20 hover:border-black"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || remaining < 1}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Film className="w-3 h-3" />}
                {busy ? 'Submitting…' : 'Start production'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
