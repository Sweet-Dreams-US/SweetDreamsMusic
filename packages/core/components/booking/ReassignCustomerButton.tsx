'use client';

// ReassignCustomerButton — move a session to a different customer account.
// Bookings link to a customer by email while files link by account id, so when a
// customer has two accounts the session + files can drift apart and the engineer
// can't complete it. This control (admin OR engineer) repoints the booking onto
// the chosen account. Search the platform's accounts (by name/email) and pick
// one; "Check" runs a dry-run that shows how many files live on each account, so
// you confirm you're moving TO the account that holds the customer's files.

import { useState, useEffect } from 'react';
import { UserCog, Loader2, ArrowRight, Search } from 'lucide-react';

interface Preview {
  from: string; to: string; targetHasAccount: boolean; targetName: string | null;
  targetFileCount: number; oldFileCount: number; movedRows: number;
}
interface UserHit { userId: string; displayName: string | null; email: string }

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

export default function ReassignCustomerButton({ bookingId, currentEmail, currentName, onDone }: {
  bookingId: string; currentEmail: string; currentName?: string | null; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(''); // set by picking a result OR typing a full email
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [err, setErr] = useState('');

  // Debounced account search as you type (skips when a result/email is locked in).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || selectedEmail) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        const d = await res.json();
        setResults(res.ok ? (d.users || []) : []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [query, selectedEmail]);

  function pick(u: UserHit) { setSelectedEmail(u.email); setQuery(`${u.displayName || u.email} <${u.email}>`); setResults([]); setPreview(null); }
  function onType(v: string) { setQuery(v); setSelectedEmail(isEmail(v) ? v.trim().toLowerCase() : ''); setPreview(null); }
  const targetEmail = selectedEmail || (isEmail(query) ? query.trim().toLowerCase() : '');

  async function call(dryRun: boolean) {
    if (!targetEmail) { setErr('Search for and pick a user, or type a full email.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/booking/reassign-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, targetEmail, dryRun }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      if (dryRun) setPreview(d); else { reset(); onDone?.(); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  function reset() { setOpen(false); setQuery(''); setResults([]); setSelectedEmail(''); setPreview(null); setConfirmText(''); setErr(''); }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 border border-black/15 text-black/60 hover:border-accent hover:text-black">
        <UserCog className="w-3 h-3" /> Move to another account
      </button>
    );
  }

  return (
    <div className="border-2 border-accent/50 bg-accent/5 p-3 space-y-2 font-mono text-xs">
      <p className="font-bold uppercase tracking-wider text-[10px]">Move session to another account</p>
      <p className="text-[10px] text-black/50">
        Now on <span className="font-bold">{currentName || '—'}</span> &lt;{currentEmail}&gt;. Search the platform for the
        account where the customer&apos;s files / login actually are.
      </p>

      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-black/30" />
            <input value={query} onChange={(e) => onType(e.target.value)} placeholder="Search users by name or email…"
              className="w-full border-2 border-black/15 pl-7 pr-2 py-1.5 focus:border-accent focus:outline-none" />
          </div>
          <button onClick={() => call(true)} disabled={busy || !targetEmail}
            className="px-3 py-1.5 font-bold uppercase text-[11px] border-2 border-black hover:bg-black/5 disabled:opacity-30 inline-flex items-center gap-1">
            {busy && !preview ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Check
          </button>
        </div>
        {(searching || results.length > 0) && !selectedEmail && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border-2 border-black/15 max-h-52 overflow-auto shadow-lg">
            {searching && <p className="px-2 py-1.5 text-[10px] text-black/40">searching…</p>}
            {!searching && results.length === 0 && <p className="px-2 py-1.5 text-[10px] text-black/40">no matching accounts</p>}
            {results.map((u) => (
              <button key={u.userId} type="button" onClick={() => pick(u)}
                className="block w-full text-left px-2 py-1.5 hover:bg-accent/10 border-b border-black/5 last:border-0">
                <span className="font-bold">{u.displayName || '(no name)'}</span>{' '}
                <span className="text-black/50">{u.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {err && <p className="text-red-600 text-[11px]">{err}</p>}

      {preview && (
        <div className="space-y-1 border-t border-black/10 pt-2">
          <p className="flex items-center gap-1.5 flex-wrap">
            {preview.from} <ArrowRight className="w-3 h-3" /> <span className="font-bold">{preview.to}</span>
            {preview.targetName ? <span className="text-black/50">({preview.targetName})</span> : null}
          </p>
          <p>{preview.targetHasAccount ? '✓ Account found.' : '⚠ No account exists for that email yet.'}</p>
          <p>Files on target: <span className="font-bold">{preview.targetFileCount}</span> · on current: <span className="font-bold">{preview.oldFileCount}</span>
            {preview.targetFileCount > 0 && preview.oldFileCount === 0 ? <span className="text-green-700"> — looks right ✓</span> : null}
          </p>
          {preview.movedRows > 1 && <p className="text-black/50">Moves {preview.movedRows} grouped session rows (band block).</p>}
          {!preview.targetHasAccount && (
            <p className="text-amber-700">No files/account there yet — only move if that&apos;s the email she&apos;ll log in with. Existing files won&apos;t follow automatically.</p>
          )}
          <p className="pt-1">Type <span className="font-bold">MOVE</span> to confirm:</p>
          <div className="flex gap-2">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              className="w-24 border-2 border-black/15 px-2 py-1.5 focus:border-accent focus:outline-none" />
            <button onClick={() => call(false)} disabled={busy || confirmText !== 'MOVE'}
              className="px-3 py-1.5 font-bold uppercase text-[11px] bg-accent text-black hover:bg-accent/90 disabled:opacity-30 inline-flex items-center gap-1">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm move
            </button>
            <button onClick={reset} className="px-3 py-1.5 font-bold uppercase text-[11px] border-2 border-black hover:bg-black/5">Cancel</button>
          </div>
        </div>
      )}
      {!preview && <button onClick={reset} className="text-[10px] text-black/40 hover:text-black underline">cancel</button>}
    </div>
  );
}
