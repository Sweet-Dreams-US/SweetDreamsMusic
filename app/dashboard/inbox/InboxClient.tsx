'use client';

// app/dashboard/inbox/InboxClient.tsx
//
// Round 9b: full inbox UI. Two-pane on desktop (list + detail), single
// column with back button on mobile. URL search param ?thread=<id>
// drives the selection so links from emails / nav can deep-link.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, ChevronRight, ArrowLeft } from 'lucide-react';
import type { ThreadWithMeta } from '@/lib/messaging';
import { fmtStampDate } from '@/lib/studio-time';
import MessageThreadView from '@/components/messaging/MessageThreadView';

export default function InboxClient() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedFromUrl = params.get('thread');

  const [threads, setThreads] = useState<ThreadWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromUrl);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/threads', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load inbox.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setThreads(data.threads as ThreadWithMeta[]);
      setError(null);
      // If no thread selected via URL, default to Sweet Dreams
      if (!selectedId && (data.threads as ThreadWithMeta[]).length > 0) {
        const sd = (data.threads as ThreadWithMeta[]).find((t) => t.kind === 'sweet_dreams');
        if (sd) setSelectedId(sd.id);
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  const selectThread = (id: string) => {
    setSelectedId(id);
    // Update URL without full page reload so deep-links work
    const next = new URLSearchParams(params.toString());
    next.set('thread', id);
    router.replace(`/dashboard/inbox?${next.toString()}`, { scroll: false });
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-black/40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-6 text-center">
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="border-2 border-dashed border-black/10 p-12 text-center">
        <p className="font-mono text-sm text-black/60">
          Your inbox is empty. Notifications from Sweet Dreams will land here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      {/* Thread list — full width on mobile when no thread selected; hidden when one is */}
      <aside className={`${selectedId ? 'hidden lg:block' : ''} space-y-2`}>
        <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 px-1 mb-1">
          {threads.length} conversation{threads.length === 1 ? '' : 's'}
        </p>
        {threads.map((t) => (
          <button
            key={t.id}
            onClick={() => selectThread(t.id)}
            className={`w-full text-left border-2 p-3 transition-colors ${
              selectedId === t.id
                ? 'border-black bg-black/[0.03]'
                : 'border-black/10 hover:border-black/40'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <p className="font-bold text-sm truncate">{t.display_name}</p>
                {t.unread && (
                  <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                )}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-black/40 shrink-0" />
            </div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
              {t.kind === 'sweet_dreams' ? 'OFFICIAL' : t.kind === 'media_booking' ? 'BOOKING' : 'DM'}
              {' · '}
              {fmtStampDate(t.last_message_at, { month: 'short', day: 'numeric' })}
            </p>
            {t.last_message_preview && (
              <p className="font-mono text-xs text-black/65 truncate mt-1">
                {t.last_message_preview}
              </p>
            )}
          </button>
        ))}
      </aside>

      {/* Thread detail — full width on mobile when selected; right pane on desktop */}
      <div className={`${selectedId ? '' : 'hidden lg:block'}`}>
        {selectedId ? (
          <div>
            <button
              onClick={() => {
                setSelectedId(null);
                const next = new URLSearchParams(params.toString());
                next.delete('thread');
                router.replace(`/dashboard/inbox${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false });
              }}
              className="lg:hidden mb-3 font-mono text-xs uppercase tracking-wider text-black/60 hover:text-black inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to inbox
            </button>
            <h2 className="text-heading-md mb-3">
              {threads.find((t) => t.id === selectedId)?.display_name ?? 'Conversation'}
            </h2>
            <MessageThreadView threadId={selectedId} />
          </div>
        ) : (
          <div className="hidden lg:flex border-2 border-dashed border-black/10 h-[60vh] items-center justify-center">
            <p className="font-mono text-sm text-black/40">
              Pick a conversation from the left to read it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
