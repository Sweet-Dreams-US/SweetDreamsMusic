'use client';

// components/admin/GenerateQuoteModal.tsx
//
// Round C: admin generates a quote from a template by picking a recipient
// (solo: search users; band: search bands) + setting expiration + optional
// custom message. Two-step flow:
//
//   1. POST /api/admin/packages/quotes  — saves as draft
//   2. POST /api/admin/packages/quotes/[id]/send  — emails + thread mirror
//
// Admin can choose Save Draft (sit on it) or Generate & Send (one click
// produces both calls).

import { useEffect, useState, useCallback } from 'react';
import { X, Loader2, Search, Send, FileText, Crown, Users, Calendar, AlertCircle } from 'lucide-react';
import { formatCents } from '@/lib/packages';
import { ENGINEERS } from '@/lib/constants';

interface TemplateLite {
  id: string;
  name: string;
  audience: 'solo' | 'band';
  is_membership: boolean;
  membership_months: number | null;
  duration_days: number | null;
  price_cents: number;
}

interface UserHit {
  user_id: string;
  display_name: string | null;
  email: string | null;
}

interface BandHit {
  id: string;
  display_name: string;
}

interface Props {
  template: TemplateLite;
  onClose: () => void;
  /** Called after successful create (and send if applicable). */
  onCreated: () => void;
}

const DEFAULT_EXPIRY_DAYS = 14;

export default function GenerateQuoteModal({ template, onClose, onCreated }: Props) {
  // Recipient selection — driven by template.audience.
  const [recipientUser, setRecipientUser] = useState<UserHit | null>(null);
  const [recipientBand, setRecipientBand] = useState<BandHit | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<(UserHit | BandHit)[]>([]);
  const [searching, setSearching] = useState(false);

  const [customerMessage, setCustomerMessage] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  // Optional salesperson attribution. Empty string = no commission
  // (the default — most packages won't have a dedicated closer).
  const [salespersonName, setSalespersonName] = useState('');
  const [salesCommissionPct, setSalesCommissionPct] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86400 * 1000);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD for <input type="date">
  });

  const [busy, setBusy] = useState<'saving' | 'sending' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced search.
  useEffect(() => {
    if (searchQ.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        if (template.audience === 'solo') {
          const res = await fetch(`/api/producer/clients?q=${encodeURIComponent(searchQ.trim())}`);
          if (!res.ok) {
            setSearchResults([]);
            return;
          }
          const body = await res.json();
          setSearchResults((body.clients ?? []) as UserHit[]);
        } else {
          const res = await fetch(`/api/admin/bands?q=${encodeURIComponent(searchQ.trim())}`);
          if (!res.ok) {
            setSearchResults([]);
            return;
          }
          const body = await res.json();
          setSearchResults((body.bands ?? []) as BandHit[]);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQ, template.audience]);

  const totalContractCents = template.is_membership
    ? template.price_cents * (template.membership_months ?? 0)
    : template.price_cents;

  const submit = useCallback(async (alsoSend: boolean) => {
    setError(null);
    if (template.audience === 'solo' && !recipientUser) {
      setError('Pick a recipient.');
      return;
    }
    if (template.audience === 'band' && !recipientBand) {
      setError('Pick a band.');
      return;
    }

    // Salesperson is optional, but if one is picked, the % must be set.
    const pctParsed = salesCommissionPct.trim() === '' ? null : parseFloat(salesCommissionPct);
    if (salespersonName && (pctParsed === null || Number.isNaN(pctParsed) || pctParsed < 0 || pctParsed > 100)) {
      setError('Set a commission % between 0 and 100 for the salesperson.');
      return;
    }
    if (!salespersonName && pctParsed !== null) {
      setError('Pick a salesperson, or clear the commission %.');
      return;
    }

    setBusy(alsoSend ? 'sending' : 'saving');
    try {
      // Step 1: create draft.
      const expiresAtISO = new Date(expiresAt + 'T23:59:59').toISOString();
      const createRes = await fetch('/api/admin/packages/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: template.id,
          user_id: recipientUser?.user_id,
          band_id: recipientBand?.id,
          customer_message: customerMessage.trim() || null,
          admin_notes: adminNotes.trim() || null,
          expires_at: expiresAtISO,
          salesperson_name: salespersonName || null,
          sales_commission_pct: salespersonName ? pctParsed : null,
        }),
      });
      const createBody = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        setError(createBody?.error || 'Could not create quote.');
        return;
      }
      const quoteId = (createBody?.quote?.id ?? '') as string;

      // Step 2: optionally send.
      if (alsoSend && quoteId) {
        const sendRes = await fetch(`/api/admin/packages/quotes/${quoteId}/send`, {
          method: 'POST',
        });
        const sendBody = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok) {
          setError(`Quote saved as draft, but send failed: ${sendBody?.error || 'unknown'}`);
          return;
        }
      }

      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(null);
    }
  }, [template, recipientUser, recipientBand, customerMessage, adminNotes, expiresAt, salespersonName, salesCommissionPct, onCreated]);

  // Live preview of the commission dollar amount, shown under the % input.
  const commissionPreviewCents = (() => {
    const pct = parseFloat(salesCommissionPct);
    if (!salespersonName || Number.isNaN(pct) || pct <= 0) return 0;
    return Math.round((totalContractCents * pct) / 100);
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4 py-8">
        <div className="bg-white text-black w-full max-w-2xl border-2 border-black">
          {/* Header */}
          <div className="border-b-2 border-black px-6 py-4 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                Generate Quote
              </p>
              <h2 className="font-bold text-xl">{template.name}</h2>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {template.is_membership ? (
                  <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-accent text-black font-bold inline-flex items-center gap-1">
                    <Crown className="w-2.5 h-2.5" /> {template.membership_months}-Month
                  </span>
                ) : (
                  <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/30 font-bold inline-flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5" /> One-Time
                  </span>
                )}
                {template.audience === 'band' && (
                  <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/30 font-bold inline-flex items-center gap-1">
                    <Users className="w-2.5 h-2.5" /> Band
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-black/40 hover:text-black" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5">
            {/* Recipient */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                Recipient ({template.audience === 'band' ? 'band' : 'user'})
              </label>
              {(recipientUser || recipientBand) ? (
                <div className="border-2 border-black p-3 inline-flex items-center justify-between gap-3 w-full">
                  <div className="flex items-center gap-2 min-w-0">
                    {template.audience === 'band' ? (
                      <Users className="w-4 h-4 text-black/45 shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded-full bg-black/10 shrink-0" />
                    )}
                    <div className="min-w-0">
                      {recipientUser && (
                        <>
                          <p className="font-bold text-sm truncate">{recipientUser.display_name || '(no name)'}</p>
                          <p className="font-mono text-[10px] text-black/55 truncate">{recipientUser.email}</p>
                        </>
                      )}
                      {recipientBand && (
                        <p className="font-bold text-sm truncate">{recipientBand.display_name}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => { setRecipientUser(null); setRecipientBand(null); setSearchQ(''); }}
                    className="text-black/40 hover:text-black shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/35" />
                    <input
                      type="text"
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder={
                        template.audience === 'band'
                          ? 'Search bands by name…'
                          : 'Search users by name or email…'
                      }
                      className="w-full border-2 border-black pl-9 pr-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                    />
                  </div>
                  {searchQ.length >= 2 && (
                    <div className="border-2 border-black/15 mt-1 max-h-56 overflow-y-auto">
                      {searching ? (
                        <div className="px-3 py-2 inline-flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span className="font-mono text-xs text-black/55">Searching…</span>
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="px-3 py-2 font-mono text-xs text-black/55">No matches.</div>
                      ) : (
                        <ul>
                          {searchResults.map((r) => {
                            if (template.audience === 'band') {
                              const b = r as BandHit;
                              return (
                                <li key={b.id}>
                                  <button
                                    onClick={() => { setRecipientBand(b); setSearchQ(''); setSearchResults([]); }}
                                    className="w-full text-left px-3 py-2 hover:bg-black/[0.04] inline-flex items-center gap-2"
                                  >
                                    <Users className="w-3 h-3 text-black/45 shrink-0" />
                                    <span className="font-mono text-xs">{b.display_name}</span>
                                  </button>
                                </li>
                              );
                            }
                            const u = r as UserHit;
                            return (
                              <li key={u.user_id}>
                                <button
                                  onClick={() => { setRecipientUser(u); setSearchQ(''); setSearchResults([]); }}
                                  className="w-full text-left px-3 py-2 hover:bg-black/[0.04] block"
                                >
                                  <p className="font-bold text-xs">{u.display_name || '(no name)'}</p>
                                  <p className="font-mono text-[10px] text-black/55">{u.email}</p>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Expiration */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                Quote expires on
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
              />
            </div>

            {/* Customer message */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                Note for the customer (optional, shown on quote page + email)
              </label>
              <textarea
                value={customerMessage}
                onChange={(e) => setCustomerMessage(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Hey — built this around what you said you needed last week. Let me know what you think."
                className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-y"
              />
            </div>

            {/* Admin internal notes */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                Internal notes (optional, never shown to customer)
              </label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Friend of Jay, will probably try to negotiate. Floor is $1500."
                className="w-full border-2 border-black px-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none resize-y"
              />
            </div>

            {/* Salesperson + commission — OPTIONAL. Leave blank for no
                commission (the default). When a salesperson is picked,
                their commission is earned when the customer pays (the
                entitlement mints) and shows up in their payroll. */}
            <div className="border border-black/15 p-3 space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-wider font-bold text-black/55">
                Salesperson commission <span className="text-black/35 normal-case">— optional, leave blank for none</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-1">
                    Salesperson
                  </label>
                  <select
                    value={salespersonName}
                    onChange={(e) => {
                      setSalespersonName(e.target.value);
                      // Clearing the salesperson clears the % too — they move together.
                      if (!e.target.value) setSalesCommissionPct('');
                    }}
                    className="w-full border-2 border-black px-2 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                  >
                    <option value="">— none —</option>
                    {ENGINEERS.map((e) => (
                      <option key={e.email} value={e.name}>{e.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-mono text-[9px] uppercase tracking-wider text-black/45 mb-1">
                    Commission %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={salesCommissionPct}
                    onChange={(e) => setSalesCommissionPct(e.target.value)}
                    disabled={!salespersonName}
                    placeholder={salespersonName ? 'e.g. 15' : '—'}
                    className="w-full border-2 border-black px-2 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none disabled:opacity-40"
                  />
                </div>
              </div>
              {commissionPreviewCents > 0 && (
                <p className="font-mono text-[11px] text-black/65">
                  <strong>{salespersonName}</strong> earns{' '}
                  <strong className="text-accent">{formatCents(commissionPreviewCents)}</strong>{' '}
                  when the customer pays — added to their payroll.
                </p>
              )}
            </div>

            {/* Total summary */}
            <div className="border-2 border-black/15 p-3 flex items-baseline justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-black/55">
                {template.is_membership ? 'Total contract value' : 'Customer pays'}
              </span>
              <span className="font-bold text-base">{formatCents(totalContractCents)}</span>
            </div>

            {error && (
              <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                <p className="font-mono text-xs text-red-900">{error}</p>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="border-t-2 border-black px-6 py-4 flex items-center justify-end gap-2 flex-wrap">
            <button
              onClick={onClose}
              disabled={busy !== null}
              className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border border-black/20 hover:border-black"
            >
              Cancel
            </button>
            <button
              onClick={() => submit(false)}
              disabled={busy !== null}
              className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border-2 border-black hover:bg-black hover:text-white inline-flex items-center gap-2 disabled:opacity-50"
            >
              {busy === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
              Save Draft
            </button>
            <button
              onClick={() => submit(true)}
              disabled={busy !== null}
              className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
            >
              {busy === 'sending' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Generate & Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
