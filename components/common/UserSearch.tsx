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
  /**
   * Typo-safety: when true, inviting a brand-new email is a DELIBERATE,
   * two-step action. The operator types an address into a draft field and must
   * click an explicit "Invite new artist <email>" button before the email is
   * committed via onInviteEmailChange. This prevents a fat-fingered address
   * from silently becoming the invite target. Gated behind this prop so
   * existing callers (which pass nothing) keep the old single-step behavior.
   */
  requireInviteConfirm?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reusable filterable user picker styled to match the MAIN SITE form look
 * (font-mono labels, border-2 inputs, accent focus) — not the cramped admin
 * <select>. Type to filter by name/email, click a row to select. When
 * allowInvite is set, the operator can toggle to "invite by email" and type a
 * new address instead of picking an existing user.
 *
 * Existing users are the clear primary path: the search field + results are
 * listed prominently and selected first. Inviting a new email is the secondary,
 * deliberate path — and when requireInviteConfirm is set it requires an
 * explicit confirm click so a typo can't quietly create a junk account.
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
  requireInviteConfirm = false,
}: UserSearchProps) {
  const [query, setQuery] = useState('');
  // 'existing' = pick from the pool; 'invite' = type a new email.
  const [mode, setMode] = useState<'existing' | 'invite'>('existing');
  // Draft email the operator is typing in confirm mode, before it's committed
  // up to the parent via onInviteEmailChange.
  const [draftEmail, setDraftEmail] = useState('');

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

  const draftValid = EMAIL_RE.test(draftEmail.trim());

  function confirmInvite() {
    const email = draftEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return;
    onInviteEmailChange?.(email);
  }

  function clearInvite() {
    onInviteEmailChange?.('');
    setDraftEmail('');
  }

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
              {m === 'existing' ? 'Existing artist' : 'Invite new'}
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
          {requireInviteConfirm ? (
            // Two-step, typo-safe invite. The committed email (inviteEmail from
            // the parent) is shown as a confirmed banner; until then the operator
            // types a draft and must explicitly click to invite it.
            inviteEmail.trim() ? (
              <div className="flex items-center justify-between gap-3 border-2 border-accent bg-accent/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                    Inviting new artist
                  </p>
                  <p className="font-mono text-sm font-semibold truncate">
                    {inviteEmail.trim()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearInvite}
                  className="font-mono text-[10px] uppercase tracking-wider text-black/50 hover:text-black shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="email"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && draftValid) {
                      e.preventDefault();
                      confirmInvite();
                    }
                  }}
                  placeholder="artist@email.com"
                  className="w-full border-2 border-black/15 px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={confirmInvite}
                  disabled={!draftValid}
                  className={cn(
                    'w-full font-mono text-xs uppercase tracking-wider px-4 py-3 border-2 transition-colors text-left',
                    draftValid
                      ? 'border-black bg-black text-white hover:bg-black/90'
                      : 'border-black/15 text-black/30 cursor-not-allowed',
                  )}
                >
                  {draftEmail.trim()
                    ? `Invite new artist ${draftEmail.trim()}`
                    : 'Type an email to invite a new artist'}
                </button>
                <p className="font-mono text-[10px] text-black/50 leading-relaxed">
                  Double-check the address — confirming creates a brand-new
                  artist account and emails a welcome / set-password link. To add
                  someone who already has an account, use the{' '}
                  <strong>Existing artist</strong> tab instead.
                </p>
              </>
            )
          ) : (
            // Legacy single-step behavior — unchanged for existing callers.
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
