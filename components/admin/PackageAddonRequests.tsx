'use client';

// components/admin/PackageAddonRequests.tsx
//
// Round E Phase 2: admin's inbox for customer-initiated add-on requests.
// Pending requests are highlighted; admin can:
//   • Decline (with optional note explaining why)
//   • Mark as Quoted after generating a follow-up quote in the
//     Templates → Quote To Customer flow (admin pastes the new quote's
//     ID into the resolve modal — which links the request to the
//     resulting quote in the audit trail)

import { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertCircle, Plus, Inbox, X, Clock as ClockIcon, Music, Film, Package, Check, MessageSquare } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface AddonRequest {
  id: string;
  entitlement_id: string;
  request_type: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  quantity: number;
  notes: string | null;
  status: 'pending' | 'quoted' | 'accepted' | 'declined';
  response_quote_id: string | null;
  admin_response_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  requester_name: string | null;
  requester_email: string | null;
  template_name: string;
}

type Filter = 'pending' | 'quoted' | 'accepted' | 'declined' | 'all';

const STATUS_LABEL: Record<AddonRequest['status'], string> = {
  pending: 'Pending',
  quoted: 'Quoted',
  accepted: 'Accepted',
  declined: 'Declined',
};

function typeIcon(t: AddonRequest['request_type']) {
  switch (t) {
    case 'studio_hours': return ClockIcon;
    case 'media_offering': return Film;
    case 'beat_credit': return Music;
    case 'custom': return Package;
  }
}

function typeLabel(r: AddonRequest): string {
  switch (r.request_type) {
    case 'studio_hours': return `${r.quantity} more studio hour${r.quantity === 1 ? '' : 's'}`;
    case 'media_offering': return 'More media work';
    case 'beat_credit': return `${r.quantity} more beat credit${r.quantity === 1 ? '' : 's'}`;
    case 'custom': return r.notes || `${r.quantity} custom item${r.quantity === 1 ? '' : 's'}`;
  }
}

export default function PackageAddonRequests() {
  const [requests, setRequests] = useState<AddonRequest[] | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<AddonRequest | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/packages/addon-requests', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load add-on requests.');
        return;
      }
      const body = await res.json();
      setRequests((body.requests ?? []) as AddonRequest[]);
    } catch {
      setError('Network error.');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-4 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-700" />
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (requests === null) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-black/40" />
      </div>
    );
  }

  const counts: Record<Filter, number> = {
    all: requests.length,
    pending: requests.filter((r) => r.status === 'pending').length,
    quoted: requests.filter((r) => r.status === 'quoted').length,
    accepted: requests.filter((r) => r.status === 'accepted').length,
    declined: requests.filter((r) => r.status === 'declined').length,
  };

  const filtered = filter === 'all' ? requests : requests.filter((r) => r.status === filter);

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(['pending', 'quoted', 'accepted', 'declined', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`font-mono text-[11px] uppercase tracking-wider font-bold px-3 py-1.5 transition-colors ${
              filter === f ? 'bg-black text-white' : 'border border-black/20 text-black/60 hover:border-black hover:text-black'
            }`}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f as AddonRequest['status']]} ({counts[f]})
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-black/10 p-12 text-center">
          <Inbox className="w-8 h-8 text-black/30 mx-auto mb-3" />
          <p className="font-mono text-sm text-black/55">
            {filter === 'pending' ? 'No pending requests.' : `No ${filter} requests.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const Icon = typeIcon(r.request_type);
            const isPending = r.status === 'pending';
            return (
              <li key={r.id} className={`border-2 p-4 ${isPending ? 'border-accent' : 'border-black/15'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Icon className="w-4 h-4 text-black/55" />
                      <h3 className="font-bold text-sm">{typeLabel(r)}</h3>
                      <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 font-bold ${
                        r.status === 'pending' ? 'bg-accent text-black' :
                        r.status === 'quoted' ? 'bg-black text-white' :
                        r.status === 'accepted' ? 'bg-green-600 text-white' :
                        'bg-black/15 text-black/55'
                      }`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-black/65">
                      <strong>{r.requester_name ?? '?'}</strong> on <em>{r.template_name}</em>
                      {r.requester_email && (
                        <span className="text-black/45 ml-2">{r.requester_email}</span>
                      )}
                    </p>
                    {r.notes && (
                      <div className="bg-black/[0.03] border-l-2 border-accent px-3 py-2 mt-2">
                        <p className="font-mono text-[11px] text-black/70 whitespace-pre-wrap">{r.notes}</p>
                      </div>
                    )}
                    {r.admin_response_notes && (
                      <div className="bg-black/[0.03] border-l-2 border-black/30 px-3 py-2 mt-2">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-black/45 mb-1">Admin response</p>
                        <p className="font-mono text-[11px] text-black/70 whitespace-pre-wrap">{r.admin_response_notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-[10px] text-black/55">
                      {fmtStampDate(r.created_at, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>

                {isPending && (
                  <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-black/10 flex-wrap">
                    <button
                      onClick={() => setResolving(r)}
                      className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-black text-white inline-flex items-center gap-1.5"
                    >
                      <MessageSquare className="w-3 h-3" />
                      Respond
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {resolving && (
        <ResolveModal
          request={resolving}
          onClose={() => setResolving(null)}
          onResolved={() => {
            setResolving(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Resolve modal — admin marks pending → quoted or declined
// ────────────────────────────────────────────────────────────────────

function ResolveModal({
  request,
  onClose,
  onResolved,
}: {
  request: AddonRequest;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [decision, setDecision] = useState<'quoted' | 'declined'>('quoted');
  const [responseQuoteId, setResponseQuoteId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (decision === 'quoted' && !responseQuoteId.trim()) {
      setError('Paste the quote ID you generated, or pick "Decline" instead.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/packages/addon-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: decision,
          response_quote_id: decision === 'quoted' ? responseQuoteId.trim() : null,
          admin_response_notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Could not save.');
        return;
      }
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white text-black w-full max-w-md border-2 border-black">
        <div className="border-b-2 border-black px-5 py-3 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Respond to request</p>
            <h3 className="font-bold text-sm">{typeLabel(request)} on {request.template_name}</h3>
          </div>
          <button onClick={onClose} className="text-black/40 hover:text-black"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDecision('quoted')}
              className={`flex-1 font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 inline-flex items-center justify-center gap-1.5 ${
                decision === 'quoted' ? 'bg-black text-white' : 'border border-black/20 text-black/60'
              }`}
            >
              <Plus className="w-3 h-3" />
              Generated quote
            </button>
            <button
              type="button"
              onClick={() => setDecision('declined')}
              className={`flex-1 font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 inline-flex items-center justify-center gap-1.5 ${
                decision === 'declined' ? 'bg-black text-white' : 'border border-black/20 text-black/60'
              }`}
            >
              <X className="w-3 h-3" />
              Decline
            </button>
          </div>

          {decision === 'quoted' && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
                Quote ID (paste from Quotes tab)
              </label>
              <input
                type="text"
                value={responseQuoteId}
                onChange={(e) => setResponseQuoteId(e.target.value)}
                placeholder="e4421c02-..."
                className="w-full border-2 border-black px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none"
              />
              <p className="font-mono text-[10px] text-black/55 mt-1">
                Generate the follow-up quote from a template first, copy its ID here.
              </p>
            </div>
          )}

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-1.5">
              Note for the customer (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={
                decision === 'quoted'
                  ? "I sent over a follow-up quote. Same discount as your membership."
                  : "We're booked solid through May — let's revisit in June?"
              }
              className="w-full border-2 border-black px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none resize-y"
            />
          </div>

          {error && (
            <p className="font-mono text-xs text-red-700">{error}</p>
          )}
        </div>
        <div className="border-t-2 border-black px-5 py-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border border-black/20 hover:border-black"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
