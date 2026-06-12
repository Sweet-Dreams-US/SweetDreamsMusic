'use client';

// components/messaging/UnreadBell.tsx
//
// Round 9b: top-nav unread badge. Polls every 60s + on focus.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

export default function UnreadBell() {
  const [count, setCount] = useState(0);
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchCount() {
      try {
        const res = await fetch('/api/messages/unread-count', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setCount(data.count ?? 0);
        setCapped(!!data.capped);
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
  }, []);

  return (
    <Link
      href="/dashboard/inbox"
      aria-label={count > 0 ? `${count}${capped ? '+' : ''} unread messages` : 'Inbox'}
      className="relative inline-flex items-center justify-center w-9 h-9 hover:bg-black/5 rounded transition-colors"
    >
      <Bell className="w-4 h-4 text-black/70" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-accent text-black font-mono text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
          {count}{capped ? '+' : ''}
        </span>
      )}
    </Link>
  );
}
