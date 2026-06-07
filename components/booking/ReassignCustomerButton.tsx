'use client';

// ReassignCustomerButton — move a session to a different customer account.
// Bookings link to a customer by email while files link by account id, so when a
// customer has two accounts the session + files can drift apart and the engineer
// can't complete it. This control (admin OR engineer) repoints the booking onto
// the chosen account. "Check" runs a dry-run that shows how many files live on
// each account, so you confirm you're moving TO the account that has her files.

import { useState } from 'react';
import { UserCog, Loader2, ArrowRight } from 'lucide-react';

interface Preview {
  targetHasAccount: boolean; targetName: string | null;
  targetFileCount: number; oldFileCount: number; movedRows: number;
}

export default function ReassignCustomerButton({ bookingId, currentEmail, currentName, onDone }: {
  bookingId: string; currentEmail: string; currentName?: string | null; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [err, setErr] = useState('');

  async function call(dryRun: boolean) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/booking/reassign-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, targetEmail: email, dryRun }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      if (dryRun) setPreview(d);
      else { reset(); onDone?.(); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  function reset() { setOpen(false); setEmail(''); setPreview(null); setConfirmText(''); setErr(''); }

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
        Now on <span className="font-bold">{currentName || '—'}</span> &lt;{currentEmail}&gt;. Enter the email of the
        account where the customer&apos;s files / login actually are.
      </p>
      <div className="flex gap-2">
        <input value={email} onChange={(e) => { setEmail(e.target.value); setPreview(null); }} placeholder="correct account email"
          className="flex-1 border-2 border-black/15 px-2 py-1.5 focus:border-accent focus:outline-none" />
        <button onClick={() => call(true)} disabled={busy || !email}
          className="px-3 py-1.5 font-bold uppercase text-[11px] border-2 border-black hover:bg-black/5 disabled:opacity-30 inline-flex items-center gap-1">
          {busy && !preview ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Check
        </button>
      </div>
      {err && <p className="text-red-600 text-[11px]">{err}</p>}
      {preview && (
        <div className="space-y-1 border-t border-black/10 pt-2">
          <p className="flex items-center gap-1.5">
            {currentEmail} <ArrowRight className="w-3 h-3" /> <span className="font-bold">{email}</span>
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
