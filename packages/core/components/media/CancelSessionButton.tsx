'use client';

// components/media/CancelSessionButton.tsx
//
// Tiny client component dropped into the order detail's session list. The
// confirm prompt is browser-native (`confirm()`) — Phase D MVP doesn't
// need a custom modal because cancellations are a low-frequency action
// and we already gate by status (only `scheduled` rows show this button).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

export default function CancelSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!confirm('Cancel this session? You can re-schedule it from this order page.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/media/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Could not cancel — try again.');
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (err) {
      console.error('[cancel-session] error:', err);
      alert('Network error — try again.');
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={cancel}
      disabled={busy}
      className="font-mono text-[11px] text-black/50 hover:text-red-700 inline-flex items-center gap-1 disabled:opacity-50"
      aria-label="Cancel session"
    >
      <X className="w-3 h-3" />
      {busy ? 'Cancelling…' : 'Cancel'}
    </button>
  );
}
