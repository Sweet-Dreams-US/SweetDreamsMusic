'use client';

// components/admin/PackageQuotes.tsx
//
// Round C: admin's quotes inbox. Shows all quotes (drafts, sent, accepted,
// declined, expired) with filter chips, recipient + template hydrated.
// Actions per row:
//   • Draft → Send (one click → fires email + thread mirror)
//   • Sent → View (open the customer's /quotes/[token] page in new tab)
//   • All → Copy Link (yank the public URL to clipboard for manual share)
//
// Admin can manually re-send a sent quote too — useful when the customer
// claims they didn't receive the email.

import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, AlertCircle, FileText, Send, ExternalLink, Copy, CheckCircle2,
  XCircle, Clock as ClockIcon, Crown, Users, Calendar, Mail,
} from 'lucide-react';
import { formatCents } from '@/lib/packages';
import { fmtStampDate } from '@/lib/studio-time';

interface QuoteRow {
  id: string;
  template_id: string;
  user_id: string | null;
  band_id: string | null;
  token: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  total_price_cents: number;
  total_full_price_cents: number;
  total_discount_cents: number;
  expires_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
  customer_message: string | null;
  admin_notes: string | null;
  template_name: string;
  template_is_membership: boolean;
  recipient_name: string | null;
  recipient_email: string | null;
}

type Filter = 'all' | 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

const STATUS_LABEL: Record<QuoteRow['status'], string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

function StatusBadge({ status }: { status: QuoteRow['status'] }) {
  const cls =
    status === 'accepted' ? 'bg-green-600 text-white' :
    status === 'declined' ? 'bg-black/40 text-white' :
    status === 'expired' ? 'bg-orange-400 text-black' :
    status === 'sent' ? 'bg-accent text-black' :
    'border border-black/30 text-black/60';
  const Icon =
    status === 'accepted' ? CheckCircle2 :
    status === 'declined' ? XCircle :
    status === 'expired' ? ClockIcon :
    status === 'sent' ? Send :
    FileText;
  return (
    <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 font-bold inline-flex items-center gap-1 ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function PackageQuotes() {
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/packages/quotes', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Could not load quotes.');
        return;
      }
      const body = await res.json();
      setQuotes((body.quotes ?? []) as QuoteRow[]);
    } catch {
      setError('Network error.');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function send(id: string) {
    setSending(id);
    try {
      const res = await fetch(`/api/admin/packages/quotes/${id}/send`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error || 'Send failed.');
        return;
      }
      await refresh();
    } finally {
      setSending(null);
    }
  }

  async function copyLink(token: string, id: string) {
    const url = `${window.location.origin}/quotes/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Fallback — just open the URL.
      window.open(url, '_blank');
    }
  }

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-4 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-700" />
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (quotes === null) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-black/40" />
      </div>
    );
  }

  const counts: Record<Filter, number> = {
    all: quotes.length,
    draft: quotes.filter((q) => q.status === 'draft').length,
    sent: quotes.filter((q) => q.status === 'sent').length,
    accepted: quotes.filter((q) => q.status === 'accepted').length,
    declined: quotes.filter((q) => q.status === 'declined').length,
    expired: quotes.filter((q) => q.status === 'expired').length,
  };

  const filtered = filter === 'all' ? quotes : quotes.filter((q) => q.status === filter);

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'draft', 'sent', 'accepted', 'declined', 'expired'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`font-mono text-[11px] uppercase tracking-wider font-bold px-3 py-1.5 transition-colors ${
              filter === f ? 'bg-black text-white' : 'border border-black/20 text-black/60 hover:border-black hover:text-black'
            }`}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f as QuoteRow['status']]} ({counts[f]})
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-black/10 p-12 text-center">
          <FileText className="w-8 h-8 text-black/30 mx-auto mb-3" />
          <p className="font-mono text-sm text-black/55 mb-1">
            {filter === 'all' ? 'No quotes yet.' : `No ${filter} quotes.`}
          </p>
          <p className="font-mono text-[11px] text-black/45">
            From the Templates tab, click "Quote To Customer" on any template to generate one.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((q) => (
            <li key={q.id} className="border-2 border-black/15 p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-sm">{q.template_name}</h3>
                    <StatusBadge status={q.status} />
                    {q.template_is_membership ? (
                      <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-accent text-black font-bold inline-flex items-center gap-1">
                        <Crown className="w-2.5 h-2.5" /> Membership
                      </span>
                    ) : (
                      <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/20 inline-flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" /> One-Time
                      </span>
                    )}
                    {q.band_id && (
                      <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/20 inline-flex items-center gap-1">
                        <Users className="w-2.5 h-2.5" /> Band
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-black/65">
                    {q.recipient_name ? <strong>{q.recipient_name}</strong> : <em>Unknown recipient</em>}
                    {q.recipient_email && (
                      <span className="text-black/45 inline-flex items-center gap-1 ml-2">
                        <Mail className="w-2.5 h-2.5" /> {q.recipient_email}
                      </span>
                    )}
                  </p>
                  {q.customer_message && (
                    <p className="font-mono text-[11px] text-black/55 mt-1 line-clamp-1">
                      &ldquo;{q.customer_message}&rdquo;
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="font-bold text-base">{formatCents(q.total_price_cents)}</p>
                  {q.total_discount_cents > 0 && (
                    <p className="font-mono text-[10px] text-accent font-bold">
                      saves {formatCents(q.total_discount_cents)}
                    </p>
                  )}
                  {q.expires_at && (
                    <p className="font-mono text-[10px] text-black/45 mt-1">
                      expires {fmtStampDate(q.expires_at, { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>

              {/* Row actions */}
              <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-black/10 flex-wrap">
                <button
                  onClick={() => copyLink(q.token, q.id)}
                  className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 border border-black/20 hover:border-black inline-flex items-center gap-1.5"
                >
                  {copiedId === q.id ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-green-700" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy Link
                    </>
                  )}
                </button>
                <a
                  href={`/quotes/${q.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 border border-black/20 hover:border-black no-underline inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3 h-3" /> Preview
                </a>
                {q.status === 'draft' && (
                  <button
                    onClick={() => send(q.id)}
                    disabled={sending === q.id}
                    className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-black text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {sending === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Send Now
                  </button>
                )}
                {q.status === 'sent' && (
                  <button
                    onClick={() => send(q.id)}
                    disabled={sending === q.id}
                    title="Re-send the same email + thread mirror"
                    className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 border border-black/20 hover:border-black inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {sending === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Re-send
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
