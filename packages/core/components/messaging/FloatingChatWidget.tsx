'use client';

// components/messaging/FloatingChatWidget.tsx
//
// Round 9b: bottom-right floating chat button + slide-out panel.
// Default content is the user's Sweet Dreams thread. Other threads
// (booking conversations + producer DMs) live in the full inbox at
// /dashboard/inbox — there's a "View all conversations →" link at
// the bottom of the panel for that.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, X, Loader2, ArrowRight } from 'lucide-react';
import MessageThreadView from './MessageThreadView';

interface Props {
  /** Whether the user is signed in. The widget hides for anonymous visitors. */
  authenticated: boolean;
}

export default function FloatingChatWidget({ authenticated }: Props) {
  const [open, setOpen] = useState(false);
  const [sweetDreamsThreadId, setSweetDreamsThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadCapped, setUnreadCapped] = useState(false);

  // Resolve the user's Sweet Dreams thread id once on mount.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/messages/threads', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const sd = (data.threads as Array<{ id: string; kind: string }> | undefined)?.find(
          (t) => t.kind === 'sweet_dreams',
        );
        setSweetDreamsThreadId(sd?.id ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated]);

  // Poll unread count every 60s + on focus while widget is closed.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    async function fetchCount() {
      try {
        const res = await fetch('/api/messages/unread-count', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setUnreadCount(data.count ?? 0);
        setUnreadCapped(!!data.capped);
      } catch { /* ignore */ }
    }
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    const onFocus = () => fetchCount();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [authenticated, open]);

  if (!authenticated) return null;

  return (
    <>
      {/* Floating button — bottom-right corner, always visible while logged in */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Sweet Dreams chat"
          className="fixed bottom-6 right-6 z-40 bg-black text-white shadow-lg hover:bg-accent hover:text-black transition-colors w-14 h-14 rounded-full flex items-center justify-center"
        >
          <MessageSquare className="w-6 h-6" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-accent text-black font-mono text-[11px] font-bold rounded-full min-w-[20px] h-[20px] px-1 flex items-center justify-center">
              {unreadCount}{unreadCapped ? '+' : ''}
            </span>
          )}
        </button>
      )}

      {/* Slide-out panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
          {/* Click-outside backdrop */}
          <div
            className="absolute inset-0 bg-black/30 pointer-events-auto"
            onClick={() => setOpen(false)}
          />
          <div className="relative pointer-events-auto w-full max-w-md bg-white shadow-2xl flex flex-col border-l-4 border-accent">
            <div className="bg-black text-white px-4 py-3 flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-white/60">
                  Sweet Dreams Music
                </p>
                <p className="font-bold text-base">Your studio chat</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="text-white/60 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col p-3">
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-black/40" />
                </div>
              ) : sweetDreamsThreadId ? (
                <MessageThreadView threadId={sweetDreamsThreadId} className="flex-1" />
              ) : (
                <p className="font-mono text-xs text-black/50 text-center py-8">
                  Your Sweet Dreams thread is being set up. Refresh in a moment.
                </p>
              )}
            </div>

            <div className="border-t-2 border-black/10 p-3 bg-black/[0.02] flex items-center justify-between">
              <p className="font-mono text-[11px] text-black/55">
                Notifications + receipts land here.
              </p>
              <Link
                href="/dashboard/inbox"
                onClick={() => setOpen(false)}
                className="font-mono text-[11px] uppercase tracking-wider text-accent hover:underline inline-flex items-center gap-1"
              >
                View all conversations
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
