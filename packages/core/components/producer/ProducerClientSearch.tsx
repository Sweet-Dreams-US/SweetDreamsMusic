'use client';

// components/producer/ProducerClientSearch.tsx
//
// Round 9d: producer-facing search-and-message UX. Producers find
// users by name/email, click "Message" to open a DM thread for a
// beat-sales pitch. Reuses the shared MessageButton component which
// creates-or-reuses the DM thread + navigates to the inbox.

import { useEffect, useState } from 'react';
import { Search, Loader2, User } from 'lucide-react';
import Image from 'next/image';
import MessageButton from '@/components/messaging/MessageButton';

interface Client {
  user_id: string;
  display_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  public_profile_slug: string | null;
  is_producer: boolean;
}

export default function ProducerClientSearch() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce input so we don't hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = debounced.length >= 2
          ? `/api/producer/clients?q=${encodeURIComponent(debounced)}`
          : '/api/producer/clients';
        const res = await fetch(url, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? 'Could not load clients.');
          return;
        }
        const data = await res.json();
        setClients((data.clients ?? []) as Client[]);
      } catch {
        if (!cancelled) setError('Network error.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debounced]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-heading-md mb-2">Message a Client</h2>
        <p className="font-mono text-xs text-black/60 max-w-2xl">
          Search for a user by name or email and start a DM to pitch a beat. Reuses an
          existing thread if you&apos;ve already messaged them; otherwise creates a fresh one.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-black/40" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full border-2 border-black/10 pl-9 pr-3 py-2 font-mono text-sm"
        />
      </div>

      {loading && (
        <div className="text-center py-6">
          <Loader2 className="w-4 h-4 animate-spin mx-auto text-black/40" />
        </div>
      )}

      {error && (
        <div className="border-2 border-red-300 bg-red-50 p-3">
          <p className="font-mono text-xs text-red-900">{error}</p>
        </div>
      )}

      {!loading && !error && clients.length === 0 && (
        <div className="border-2 border-dashed border-black/10 p-8 text-center">
          <p className="font-mono text-sm text-black/50">
            {debounced.length >= 2
              ? `No users matching "${debounced}".`
              : 'Type at least 2 characters to search.'}
          </p>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <ul className="space-y-2">
          {clients.map((c) => (
            <li
              key={c.user_id}
              className="border-2 border-black/10 p-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                {c.profile_picture_url ? (
                  <Image
                    src={c.profile_picture_url}
                    alt={c.display_name ?? 'User'}
                    width={36}
                    height={36}
                    className="w-9 h-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-black/10 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-black/40" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">
                    {c.display_name ?? '(no name)'}
                    {c.is_producer && (
                      <span className="ml-2 font-mono text-[9px] uppercase tracking-wider bg-black text-white px-1.5 py-0.5">
                        producer
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-[11px] text-black/50 truncate">
                    {c.email ?? '(no email)'}
                  </p>
                </div>
              </div>
              <MessageButton
                targetUserId={c.user_id}
                targetLabel={c.display_name ?? undefined}
                size="sm"
                variant="secondary"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
