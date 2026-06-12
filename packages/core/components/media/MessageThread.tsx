'use client';

// components/media/MessageThread.tsx
//
// Round 8b → Round 9b: thin wrapper that resolves a booking's thread_id
// once on mount, then defers to <MessageThreadView>. Same prop interface
// for callers (`bookingId`) — internals migrated to the unified
// /api/messages/threads endpoint so booking-page conversations land in
// the unified inbox + show with the new bubble styling.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import MessageThreadView from '@/components/messaging/MessageThreadView';

interface Props {
  bookingId: string;
  className?: string;
  canPost?: boolean;
}

export default function MessageThread({ bookingId, className, canPost = true }: Props) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/messages/threads/from-booking/${bookingId}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) setError('Conversation not available for this order.');
          else setError('Could not load conversation.');
          return;
        }
        const data = await res.json();
        setThreadId(data.thread_id ?? null);
      } catch {
        if (!cancelled) setError('Network error loading conversation.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (error) {
    return (
      <div className={`border-2 border-red-300 bg-red-50 p-4 ${className ?? ''}`}>
        <p className="font-mono text-xs text-red-900">{error}</p>
      </div>
    );
  }

  if (!threadId) {
    return (
      <div className={`border-2 border-black/10 p-6 text-center ${className ?? ''}`}>
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-black/40" />
        <p className="font-mono text-xs text-black/40 mt-2">Loading conversation…</p>
      </div>
    );
  }

  return <MessageThreadView threadId={threadId} className={className} canPost={canPost} />;
}
