'use client';

// app/admin/messages/AdminMessagesClient.tsx
//
// Round 9e: support queue UI. List of all Sweet Dreams threads with
// "Needs reply" filter chip, sorted by last activity. Click a row →
// /dashboard/inbox?thread=<id> to read + reply (uses the same chat UI
// as the buyer side).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageSquare, Mail, AlertCircle } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface SupportRow {
  thread_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_author_role: string | null;
  needs_reply: boolean;
  message_count: number;
}

type Filter = 'all' | 'needs_reply' | 'has_messages';

export default function AdminMessagesClient() {
  const [rows, setRows] = useState<SupportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('needs_reply');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/messages', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setError('Could not load support queue.');
          return;
        }
        const data = await res.json();
        setRows((data.rows ?? []) as SupportRow[]);
      } catch {
        if (!cancelled) setError('Network error.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-black/40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-4 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-700" />
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  const needsReply = rows.filter((r) => r.needs_reply);
  const hasMessages = rows.filter((r) => r.message_count > 0);
  const filtered = filter === 'all'
    ? rows
    : filter === 'needs_reply'
      ? needsReply
      : hasMessages;

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip
          active={filter === 'needs_reply'}
          label={`Needs reply (${needsReply.length})`}
          onClick={() => setFilter('needs_reply')}
        />
        <FilterChip
          active={filter === 'has_messages'}
          label={`Has messages (${hasMessages.length})`}
          onClick={() => setFilter('has_messages')}
        />
        <FilterChip
          active={filter === 'all'}
          label={`All threads (${rows.length})`}
          onClick={() => setFilter('all')}
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-black/10 p-12 text-center">
          <p className="font-mono text-sm text-black/50">
            {filter === 'needs_reply'
              ? 'Nothing in the queue right now. All caught up.'
              : 'No threads match this filter.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.thread_id}>
              <Link
                href={`/dashboard/inbox?thread=${r.thread_id}`}
                className={`block border-2 p-4 transition-colors no-underline ${
                  r.needs_reply
                    ? 'border-accent hover:bg-accent/5 text-black'
                    : 'border-black/10 hover:border-black/40 text-black'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="font-bold text-sm truncate">{r.user_name}</p>
                      <p className="font-mono text-[11px] text-black/55 truncate inline-flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {r.user_email}
                      </p>
                      {r.needs_reply && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-accent text-black font-bold">
                          needs reply
                        </span>
                      )}
                    </div>
                    {r.last_message_preview ? (
                      <p className="font-mono text-xs text-black/65 mt-1 line-clamp-2">
                        <span className="font-bold mr-1">
                          [{r.last_author_role}]
                        </span>
                        {r.last_message_preview}
                      </p>
                    ) : (
                      <p className="font-mono text-[11px] text-black/40 italic mt-1">
                        No messages yet — automated notifications only.
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-[10px] text-black/50">
                      {fmtStampDate(r.last_message_at, { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="font-mono text-[10px] text-black/40 inline-flex items-center gap-1 mt-0.5">
                      <MessageSquare className="w-2.5 h-2.5" />
                      {r.message_count}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`font-mono text-[11px] uppercase tracking-wider font-bold px-3 py-1.5 transition-colors ${
        active
          ? 'bg-black text-white'
          : 'border border-black/20 text-black/60 hover:border-black hover:text-black'
      }`}
    >
      {label}
    </button>
  );
}
