'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2 } from 'lucide-react';

/**
 * Accept / reject buttons for a band invite. Wired to /api/bands/invites/[token]
 * with action=accept|reject. On accept, redirects to the new band hub; on
 * reject, falls back to /dashboard/bands.
 */
export default function InviteActions({
  token,
  bandName,
}: {
  token: string;
  bandName: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(kind: 'accept' | 'reject') {
    setError(null);
    setAction(kind);
    try {
      const res = await fetch(`/api/bands/invites/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');

      if (kind === 'accept' && data.bandId) {
        router.push(`/dashboard/bands/${data.bandId}`);
      } else {
        router.push('/dashboard/bands');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setAction(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="border-2 border-red-500 bg-red-50 p-3 flex items-start gap-2 text-left max-w-md mx-auto">
          <p className="font-mono text-xs text-red-700">{error}</p>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          onClick={() => handle('accept')}
          disabled={action !== null}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-4 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
        >
          {action === 'accept' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Joining...
            </>
          ) : (
            <>
              <Check className="w-4 h-4" /> Join {bandName}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => handle('reject')}
          disabled={action !== null}
          className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-4 hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
        >
          {action === 'reject' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Declining...
            </>
          ) : (
            <>
              <X className="w-4 h-4" /> Decline
            </>
          )}
        </button>
      </div>
    </div>
  );
}
