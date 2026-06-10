'use client';

// app/dashboard/inbox/InboxClient.tsx
//
// The permission-matrix inbox (Plan 4 §4). Two-pane on desktop, single column
// with back button on mobile; ?thread=<id> deep-links.
//
// Artists: studio thread pinned, then DMs + booking threads by recency, plus a
// "New message" composer whose recipient picker only ever offers staff +
// producers (artist↔artist is impossible from the UI and rejected by the API).
// Staff: the same inbox ALSO carries the studio threads of the people they
// serve (admin = everyone, engineer = their session clients, media manager =
// their media clients) with filter tabs — no tab hunting across pages. Staff +
// producers also get the Broadcast composer (segment-scoped by the matrix).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, ChevronRight, ArrowLeft, PenSquare, Megaphone, Search, X } from 'lucide-react';
import type { ThreadWithMeta } from '@/lib/messaging';
import { fmtStampDate } from '@/lib/studio-time';
import MessageThreadView from '@/components/messaging/MessageThreadView';

type InboxThread = ThreadWithMeta & { mine?: boolean };
type FilterTab = 'all' | 'studio' | 'bookings' | 'dms';
type ViewerRole = 'user' | 'engineer' | 'admin' | 'media_manager' | 'agent';

interface Recipient { user_id: string; name: string; email: string; role: string; is_producer: boolean }

const SEGMENTS_BY_ROLE: Record<string, { value: string; label: string }[]> = {
  admin: [
    { value: 'everyone', label: 'Everyone' },
    { value: 'all_artists', label: 'All artists' },
    { value: 'all_engineers', label: 'All engineers' },
    { value: 'all_producers', label: 'All producers' },
    { value: 'active_90d', label: 'Active last 90 days' },
    { value: 'upcoming_sessions', label: 'Upcoming sessions' },
    { value: 'beat_buyers', label: 'Beat buyers' },
  ],
  engineer: [{ value: 'my_clients', label: 'My clients' }],
  media_manager: [{ value: 'my_clients', label: 'My clients' }],
  producer: [{ value: 'my_buyers', label: 'My beat buyers' }],
};

export default function InboxClient() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedFromUrl = params.get('thread');

  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [viewerRole, setViewerRole] = useState<ViewerRole>('user');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromUrl);
  const [filter, setFilter] = useState<FilterTab>('all');

  // New-message composer state
  const [showCompose, setShowCompose] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Recipient[]>([]);
  const [picked, setPicked] = useState<Recipient[]>([]);
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Broadcast composer state
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [bSegment, setBSegment] = useState('');
  const [bSubject, setBSubject] = useState('');
  const [bBody, setBBody] = useState('');
  const [bEmail, setBEmail] = useState(true);
  const [bBusy, setBBusy] = useState(false);
  const [bNotice, setBNotice] = useState<string | null>(null);
  const [bConfirm, setBConfirm] = useState<number | null>(null);

  // Producer-ness isn't in the threads response; the broadcast button shows for
  // staff roles, and for plain users we detect producer segments lazily: the
  // API rejects non-producers anyway, so the button shows only for staff +
  // (best-effort) producers via a tiny profile fetch.
  const [isProducer, setIsProducer] = useState(false);
  useEffect(() => {
    fetch('/api/profile').then((r) => r.json())
      .then((d) => setIsProducer(!!d?.profile?.is_producer || !!d?.is_producer))
      .catch(() => {});
  }, []);

  // One-shot auto-select guard: keeping selectedId OUT of load's deps avoids
  // the mount double-fetch (load → setSelectedId → new load identity → refetch)
  // the review fleet flagged. The first fetch auto-selects the user's OWN
  // studio thread exactly once per mount.
  const autoSelectedRef = useRef(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/threads', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load inbox.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setThreads(data.threads as InboxThread[]);
      if (data.viewer_role) setViewerRole(data.viewer_role as ViewerRole);
      setError(null);
      if (!autoSelectedRef.current && (data.threads as InboxThread[]).length > 0) {
        autoSelectedRef.current = true;
        setSelectedId((current) => {
          if (current) return current; // URL deep-link wins
          const sd = (data.threads as InboxThread[]).find((t) => t.kind === 'sweet_dreams' && t.mine !== false);
          return sd ? sd.id : current;
        });
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectThread = (id: string) => {
    setSelectedId(id);
    const next = new URLSearchParams(params.toString());
    next.set('thread', id);
    router.replace(`/dashboard/inbox?${next.toString()}`, { scroll: false });
    // Refresh the list so unread dots clear as threads get read (same cadence
    // the old per-selection refetch provided, now explicit + single).
    load();
  };

  // Debounced recipient search.
  useEffect(() => {
    if (!showCompose) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/messages/recipients?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (res.ok) setResults((data.recipients ?? []) as Recipient[]);
      } catch { /* type-ahead is best-effort */ }
    }, 250);
  }, [query, showCompose]);

  async function startThread() {
    if (picked.length === 0) return;
    setComposeBusy(true); setComposeError(null);
    try {
      const res = await fetch('/api/messages/dm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_user_ids: picked.map((p) => p.user_id) }),
      });
      const data = await res.json();
      if (!res.ok) { setComposeError(data.error || 'Could not start the conversation'); return; }
      setShowCompose(false); setPicked([]); setQuery(''); setResults([]);
      await load();
      selectThread(data.thread_id);
    } catch { setComposeError('Network error'); }
    finally { setComposeBusy(false); }
  }

  async function sendBroadcast(confirmCount?: number) {
    if (!bSegment || !bSubject.trim() || !bBody.trim()) { setBNotice('Pick a segment and write a subject + message.'); return; }
    setBBusy(true); setBNotice(null);
    try {
      const res = await fetch('/api/messages/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segment: bSegment, subject: bSubject.trim(), body: bBody.trim(),
          emailMirror: bEmail, ...(confirmCount != null ? { confirmCount } : {}),
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresConfirmation) {
        setBConfirm(data.count);
        return;
      }
      if (!res.ok) { setBNotice(data.error || 'Broadcast failed'); return; }
      setBNotice(`Sent to ${data.delivered} inbox${data.delivered === 1 ? '' : 'es'}${data.emailed ? ` + ${data.emailed} emails` : ''}.`);
      setBConfirm(null); setBSubject(''); setBBody('');
      await load();
    } catch { setBNotice('Network error'); }
    finally { setBBusy(false); }
  }

  const isStaff = viewerRole === 'admin' || viewerRole === 'engineer' || viewerRole === 'media_manager';
  const canBroadcast = isStaff || isProducer;
  const segments = SEGMENTS_BY_ROLE[viewerRole] ?? (isProducer ? SEGMENTS_BY_ROLE.producer : []);

  const visible = threads.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'studio') return t.kind === 'sweet_dreams';
    if (filter === 'bookings') return t.kind === 'media_booking';
    return t.kind === 'producer_dm' || t.kind === 'dm';
  });

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

  return (
    <div>
      {/* Action row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => { setShowCompose((v) => !v); setShowBroadcast(false); }}
          className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black/80 inline-flex items-center gap-1.5">
          <PenSquare className="w-3.5 h-3.5" /> New message
        </button>
        {canBroadcast && (
          <button onClick={() => { setShowBroadcast((v) => !v); setShowCompose(false); setBSegment(segments[0]?.value ?? ''); }}
            className="border-2 border-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent hover:border-accent inline-flex items-center gap-1.5">
            <Megaphone className="w-3.5 h-3.5" /> Broadcast
          </button>
        )}
        {isStaff && (
          <div className="flex gap-1 ml-auto">
            {([
              { key: 'all', label: 'All' },
              { key: 'studio', label: 'Studio' },
              { key: 'bookings', label: 'Bookings' },
              { key: 'dms', label: 'DMs' },
            ] as { key: FilterTab; label: string }[]).map((tab) => (
              <button key={tab.key} onClick={() => setFilter(tab.key)}
                className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors ${
                  filter === tab.key ? 'bg-black text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* New-message composer (matrix-scoped picker) */}
      {showCompose && (
        <div className="border-2 border-black p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-4 h-4 text-black/40" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="flex-1 border-b-2 border-black/15 py-1 font-mono text-sm focus:border-accent focus:outline-none"
            />
          </div>
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {picked.map((p) => (
                <span key={p.user_id} className="inline-flex items-center gap-1 bg-black text-white font-mono text-[11px] px-2 py-1">
                  {p.name}
                  <button onClick={() => setPicked((x) => x.filter((y) => y.user_id !== p.user_id))}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
          {results.length > 0 && (
            <div className="border border-black/10 divide-y divide-black/5 mb-3 max-h-56 overflow-y-auto">
              {results.filter((r) => !picked.some((p) => p.user_id === r.user_id)).map((r) => (
                <button key={r.user_id}
                  onClick={() => { setPicked((x) => [...x, r]); setQuery(''); setResults([]); }}
                  className="w-full text-left px-3 py-2 hover:bg-black/[0.03] flex items-center gap-2">
                  <span className="font-mono text-sm font-bold">{r.name}</span>
                  <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-black/5 text-black/50">
                    {r.role !== 'user' ? r.role.replace('_', ' ') : r.is_producer ? 'producer' : 'artist'}
                  </span>
                  <span className="font-mono text-[11px] text-black/40 truncate">{r.email}</span>
                </button>
              ))}
            </div>
          )}
          {composeError && <p className="font-mono text-xs text-red-600 mb-2">{composeError}</p>}
          <div className="flex gap-2">
            <button onClick={startThread} disabled={picked.length === 0 || composeBusy}
              className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 disabled:opacity-40">
              {composeBusy ? 'Starting…' : 'Start conversation'}
            </button>
            <button onClick={() => { setShowCompose(false); setPicked([]); setQuery(''); setComposeError(null); }}
              className="font-mono text-xs text-black/50 hover:text-black px-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Broadcast composer (staff + producers; segments per the matrix) */}
      {showBroadcast && (
        <div className="border-2 border-black p-4 mb-4">
          <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Megaphone className="w-3.5 h-3.5 text-accent" /> Broadcast
          </p>
          <div className="grid gap-3 sm:grid-cols-2 mb-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">Audience</label>
              <select value={bSegment} onChange={(e) => { setBSegment(e.target.value); setBConfirm(null); }}
                className="w-full border-2 border-black/15 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none">
                {segments.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">Subject</label>
              <input value={bSubject} onChange={(e) => setBSubject(e.target.value)} maxLength={150}
                className="w-full border-2 border-black/15 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
            </div>
          </div>
          <textarea value={bBody} onChange={(e) => setBBody(e.target.value)} rows={4} maxLength={5000}
            placeholder="Lands in each recipient's Studio thread — replies come back as normal conversation."
            className="w-full border-2 border-black/15 px-2.5 py-2 font-mono text-sm focus:border-accent focus:outline-none mb-2" />
          <label className="flex items-center gap-2 font-mono text-xs text-black/60 mb-3">
            <input type="checkbox" checked={bEmail} onChange={(e) => setBEmail(e.target.checked)} />
            Also send as email
          </label>
          {bConfirm != null && (
            <div className="border-2 border-amber-400 bg-amber-50/50 p-3 mb-3">
              <p className="font-mono text-xs text-amber-900 mb-2">
                This goes to <strong>{bConfirm} people</strong> — everyone on the platform. Are you sure?
              </p>
              <button onClick={() => sendBroadcast(bConfirm)} disabled={bBusy}
                className="bg-amber-600 text-white font-mono text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 disabled:opacity-50">
                {bBusy ? 'Sending…' : `Yes, send to all ${bConfirm}`}
              </button>
            </div>
          )}
          {bNotice && <p className="font-mono text-xs text-black/60 mb-2">{bNotice}</p>}
          <div className="flex gap-2">
            <button onClick={() => sendBroadcast()} disabled={bBusy || bConfirm != null}
              className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 disabled:opacity-40">
              {bBusy ? 'Sending…' : 'Send broadcast'}
            </button>
            <button onClick={() => { setShowBroadcast(false); setBNotice(null); setBConfirm(null); }}
              className="font-mono text-xs text-black/50 hover:text-black px-2">Cancel</button>
          </div>
        </div>
      )}

      {threads.length === 0 ? (
        <div className="border-2 border-dashed border-black/10 p-12 text-center">
          <p className="font-mono text-sm text-black/60">
            Your inbox is empty. Notifications from Sweet Dreams will land here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          <aside className={`${selectedId ? 'hidden lg:block' : ''} space-y-2`}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 px-1 mb-1">
              {visible.length} conversation{visible.length === 1 ? '' : 's'}
            </p>
            {visible.map((t) => (
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
                  {t.kind === 'sweet_dreams' ? 'STUDIO' : t.kind === 'media_booking' ? 'BOOKING' : 'DM'}
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
      )}
    </div>
  );
}
