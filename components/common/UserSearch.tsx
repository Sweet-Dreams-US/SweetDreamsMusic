'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface UserSearchUser {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone?: string | null;
}

export interface UserSearchProps {
  /** The pool of users to search/pick from. */
  users: UserSearchUser[];
  /** Currently selected user_id ('' when none). Controlled. */
  value: string;
  /** Called with the picked user_id (or '' to clear). */
  onChange: (userId: string) => void;
  /** Search box placeholder. */
  placeholder?: string;
  /** When true, render an "invite by email" affordance below the picker. */
  allowInvite?: boolean;
  /** Controlled invite email (only used when allowInvite). */
  inviteEmail?: string;
  /** Called when the invite email changes (only used when allowInvite). */
  onInviteEmailChange?: (email: string) => void;
}

/**
 * Reusable filterable user picker styled to match the MAIN SITE form look
 * (font-mono labels, border-2 inputs, accent focus) — not the cramped admin
 * <select>. Type to filter by name/email, click a row to select. When
 * allowInvite is set, the operator can toggle to "invite by email" and type a
 * new address instead of picking an existing user.
 *
 * Fully controlled: `value` is the selected user_id, `onChange` reports picks.
 */
export default function UserSearch({
  users,
  value,
  onChange,
  placeholder = 'Search by name or email…',
  allowInvite = false,
  inviteEmail = '',
  onInviteEmailChange,
}: UserSearchProps) {
  const [query, setQuery] = useState('');
  // 'existing' = pick from the pool; 'invite' = type a new email.
  const [mode, setMode] = useState<'existing' | 'invite'>('existing');

  const selected = useMemo(
    () => users.find((u) => u.user_id === value) || null,
    [users, value],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        (u.display_name || '').toLowerCase().includes(needle) ||
        (u.email || '').toLowerCase().includes(needle) ||
        (u.phone || '').toLowerCase().includes(needle),
    );
  }, [users, query]);

  return (
    <div className="space-y-3">
      {allowInvite && (
        <div className="flex gap-2">
          {(['existing', 'invite'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'font-mono text-xs uppercase tracking-wider px-3 py-2 border-2 transition-colors',
                mode === m
                  ? 'bg-black text-white border-black'
                  : 'border-black/15 hover:border-black/40',
              )}
            >
              {m === 'existing' ? 'Existing' : 'Invite by email'}
            </button>
          ))}
        </div>
      )}

      {(!allowInvite || mode === 'existing') && (
        <div className="space-y-2">
          {/* Selected state banner */}
          {selected && (
            <div className="flex items-center justify-between gap-3 border-2 border-accent bg-accent/10 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold truncate">
                  {selected.display_name || '(no name)'}
                </p>
                <p className="font-mono text-xs text-black/60 truncate">
                  {selected.email || '(no email)'}
                  {selected.phone ? ` · ${selected.phone}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onChange('')}
                className="font-mono text-[10px] uppercase tracking-wider text-black/50 hover:text-black shrink-0"
              >
                Change
              </button>
            </div>
          )}

          {/* Search + results — hidden once a user is selected to keep it clean */}
          {!selected && (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="w-full border-2 border-black/15 px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
              />
              <div className="max-h-64 overflow-y-auto border-2 border-black/15 divide-y divide-black/10">
                {filtered.length === 0 ? (
                  <p className="font-mono text-xs text-black/40 px-4 py-3">
                    No matches.
                  </p>
                ) : (
                  filtered.map((u) => (
                    <button
                      key={u.user_id}
                      type="button"
                      onClick={() => {
                        onChange(u.user_id);
                        setQuery('');
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-accent/10 transition-colors"
                    >
                      <p className="font-mono text-sm truncate">
                        {u.display_name || '(no name)'}
                      </p>
                      <p className="font-mono text-xs text-black/60 truncate">
                        {u.email || '(no email)'}
                        {u.phone ? ` · ${u.phone}` : ''}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {allowInvite && mode === 'invite' && (
        <div className="space-y-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => onInviteEmailChange?.(e.target.value)}
            placeholder="artist@email.com"
            className="w-full border-2 border-black/15 px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
          />
          <p className="font-mono text-[10px] text-black/50 leading-relaxed">
            New email → we create the artist account + email a welcome /
            set-password link so they can log in and see this project. An
            existing email just attaches.
          </p>
        </div>
      )}
    </div>
  );
}
