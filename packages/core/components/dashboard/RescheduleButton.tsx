'use client';

import { useState } from 'react';

export default function RescheduleButton({ bookingId }: { bookingId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/booking/reschedule-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to submit request');
      } else {
        setSubmitted(true);
        setShowForm(false);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <p className="font-mono text-[10px] text-amber-600 font-semibold mt-2 pt-2 border-t border-black/5">
        Reschedule requested — we&apos;ll be in touch
      </p>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-black/5">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="font-mono text-[10px] text-black/40 hover:text-black/70 transition-colors underline"
        >
          Request Reschedule
        </button>
      ) : (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why would you like to reschedule? (e.g., prefer a different engineer, need a different date)"
            className="w-full border border-black/10 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-none transition-colors"
            rows={2}
          />
          {error && <p className="font-mono text-[10px] text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || !reason.trim()}
              className="font-mono text-[10px] font-bold uppercase tracking-wider bg-black text-white px-4 py-1.5 hover:bg-black/80 disabled:opacity-30 transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
            <button
              onClick={() => { setShowForm(false); setReason(''); setError(null); }}
              className="font-mono text-[10px] text-black/40 hover:text-black/70 transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="font-mono text-[10px] text-black/30">
            Note: Your deposit is non-refundable. Rescheduling is subject to availability.
          </p>
        </div>
      )}
    </div>
  );
}
