'use client';

// components/messaging/MessageButton.tsx
//
// Reusable "Message [user]" button. Click → POST /api/messages/dm to
// create-or-reuse a DM thread, then navigate to /dashboard/inbox with
// that thread selected. Shows a friendly error inline if the API
// rejects (e.g., trying to DM a non-producer when the caller isn't one).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Loader2 } from 'lucide-react';

interface Props {
  targetUserId: string;
  targetLabel?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  /** Optional label override; defaults to "Message [name]" or "Message" */
  label?: string;
  className?: string;
}

export default function MessageButton({
  targetUserId,
  targetLabel,
  size = 'md',
  variant = 'primary',
  label,
  className,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buttonText = label ?? (targetLabel ? `Message ${targetLabel}` : 'Message');

  async function startDm() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/messages/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_user_id: targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not start conversation.');
        return;
      }
      router.push(`/dashboard/inbox?thread=${data.thread_id}`);
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }

  const sizeClasses = size === 'sm'
    ? 'text-[11px] px-3 py-1.5'
    : 'text-sm px-4 py-2';
  const variantClasses = variant === 'primary'
    ? 'bg-black text-white hover:bg-accent hover:text-black'
    : 'border-2 border-black/20 hover:border-black bg-white text-black';

  return (
    <div className={`inline-flex flex-col items-end gap-1 ${className ?? ''}`}>
      <button
        onClick={startDm}
        disabled={loading}
        className={`font-mono uppercase tracking-wider font-bold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 ${sizeClasses} ${variantClasses}`}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
        {buttonText}
      </button>
      {error && (
        <p className="font-mono text-[10px] text-red-700 text-right max-w-xs">{error}</p>
      )}
    </div>
  );
}
